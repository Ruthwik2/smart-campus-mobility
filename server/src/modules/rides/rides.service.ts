import type { Prisma, RideStatus, Role } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { env } from '../../config/env';
import { bus } from '../../lib/bus';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../middleware/error';
import { estimateFare, haversineKm } from '../../utils/geo';
import { ACTIVE_STATUSES, assertTransition } from './rides.machine';

export const rideInclude = {
  passenger: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
  driver: {
    select: {
      id: true,
      userId: true,
      vehicleType: true,
      vehicleModel: true,
      vehiclePlate: true,
      ratingAvg: true,
      ratingCount: true,
      currentLat: true,
      currentLng: true,
      user: { select: { fullName: true, phone: true, avatarUrl: true } },
    },
  },
  rating: true,
} satisfies Prisma.RideInclude;

export type RideWithRelations = Prisma.RideGetPayload<{ include: typeof rideInclude }>;

const newRideCode = () => `R-${randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, '0')}`;
const newOtp = () => String(randomInt(1000, 10000));

const getRide = async (id: string): Promise<RideWithRelations> => {
  const ride = await prisma.ride.findUnique({ where: { id }, include: rideInclude });
  if (!ride) throw new ApiError(404, 'RIDE_NOT_FOUND', 'Ride not found');
  return ride;
};

async function logEvent(rideId: string, type: string, actorRole?: Role, data?: Prisma.InputJsonValue) {
  await prisma.rideEvent.create({ data: { rideId, type, actorRole, data } });
}

// ───────────────────────────── Request / schedule ─────────────────────────────

export async function requestRide(
  passengerId: string,
  input: {
    pickupLabel: string;
    pickupLat: number;
    pickupLng: number;
    dropLabel: string;
    dropLat: number;
    dropLng: number;
    paymentMethod?: 'CASH' | 'UPI';
    scheduledFor?: Date;
  },
) {
  // One active ride per passenger keeps the dispatch board honest.
  const active = await prisma.ride.findFirst({
    where: { passengerId, status: { in: ACTIVE_STATUSES } },
    select: { id: true, code: true },
  });
  if (active) {
    throw new ApiError(409, 'RIDE_ALREADY_ACTIVE', `You already have an active ride (${active.code})`);
  }

  const distanceKm = haversineKm(input.pickupLat, input.pickupLng, input.dropLat, input.dropLng);
  const isScheduled = Boolean(input.scheduledFor && input.scheduledFor.getTime() > Date.now() + 60_000);

  const ride = await prisma.ride.create({
    data: {
      code: newRideCode(),
      passengerId,
      pickupLabel: input.pickupLabel,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      dropLabel: input.dropLabel,
      dropLat: input.dropLat,
      dropLng: input.dropLng,
      paymentMethod: input.paymentMethod ?? 'CASH',
      distanceKm: Number(distanceKm.toFixed(2)),
      estimatedFare: estimateFare(distanceKm),
      status: isScheduled ? 'SCHEDULED' : 'REQUESTED',
      scheduledFor: isScheduled ? input.scheduledFor : null,
      startOtp: newOtp(),
    },
    include: rideInclude,
  });

  await logEvent(ride.id, isScheduled ? 'SCHEDULED' : 'REQUESTED', 'PASSENGER');
  if (isScheduled) {
    bus.publish('ride.updated', { ride });
  } else {
    bus.publish('ride.requested', { ride });
  }
  return ride;
}

/** Flips a SCHEDULED ride onto the live board (called by the scheduler worker). */
export async function dispatchScheduledRide(rideId: string) {
  const res = await prisma.ride.updateMany({
    where: { id: rideId, status: 'SCHEDULED' },
    data: { status: 'REQUESTED', requestedAt: new Date() },
  });
  if (res.count === 0) return null; // cancelled in the meantime
  const ride = await getRide(rideId);
  await logEvent(rideId, 'REQUESTED', undefined, { via: 'scheduler' });
  bus.publish('ride.requested', { ride });
  return ride;
}

// ───────────────────────────── Accept (the race) ─────────────────────────────

/**
 * Exactly-one-driver assignment under concurrency.
 *
 * Two guarded `updateMany` calls inside one transaction:
 *   1. ride:   REQUESTED + driverId IS NULL  → ACCEPTED        (loser sees count=0)
 *   2. driver: ONLINE                        → BUSY            (driver already on a job rolls back)
 *
 * Postgres row locking makes the first write win; everyone else gets a clean
 * 409 instead of a double booking. No advisory locks or queues needed.
 */
export async function acceptRide(rideId: string, driverUserId: string) {
  const driver = await prisma.driverProfile.findUnique({ where: { userId: driverUserId } });
  if (!driver) throw new ApiError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');
  if (driver.verificationStatus !== 'APPROVED') {
    throw new ApiError(403, 'NOT_VERIFIED', 'Your account is awaiting verification');
  }

  await prisma.$transaction(async (tx) => {
    const rideRes = await tx.ride.updateMany({
      where: { id: rideId, status: 'REQUESTED', driverId: null },
      data: { status: 'ACCEPTED', driverId: driver.id, acceptedAt: new Date() },
    });
    if (rideRes.count === 0) {
      throw new ApiError(409, 'RIDE_TAKEN', 'This ride was just taken or is no longer available');
    }
    const drvRes = await tx.driverProfile.updateMany({
      where: { id: driver.id, status: 'ONLINE' },
      data: { status: 'BUSY' },
    });
    if (drvRes.count === 0) {
      throw new ApiError(409, 'DRIVER_UNAVAILABLE', 'Go online (and finish any active ride) first');
    }
  });

  const ride = await getRide(rideId);
  await logEvent(rideId, 'ACCEPTED', 'DRIVER', { driverId: driver.id });
  bus.publish('ride.updated', { ride, previousStatus: 'REQUESTED' });
  bus.publish('ride.unavailable', { rideId, reason: 'TAKEN' });
  bus.publish('driver.presence', { driverId: driver.id, userId: driverUserId, status: 'BUSY' });
  return ride;
}

// ───────────────────────────── Start / complete ─────────────────────────────

export async function startRide(rideId: string, driverUserId: string, otp: string) {
  const ride = await getRide(rideId);
  if (ride.driver?.userId !== driverUserId) throw new ApiError(403, 'NOT_YOUR_RIDE', 'This ride is not assigned to you');
  assertTransition(ride.status, 'IN_PROGRESS');
  if (ride.startOtp && ride.startOtp !== otp) {
    throw new ApiError(400, 'BAD_OTP', 'Pickup code does not match — ask the passenger for their 4-digit code');
  }

  await guardedUpdate(rideId, ride.status, { status: 'IN_PROGRESS', startedAt: new Date() });
  const updated = await getRide(rideId);
  await logEvent(rideId, 'STARTED', 'DRIVER');
  bus.publish('ride.updated', { ride: updated, previousStatus: ride.status });
  return updated;
}

export async function completeRide(rideId: string, driverUserId: string) {
  const ride = await getRide(rideId);
  if (ride.driver?.userId !== driverUserId) throw new ApiError(403, 'NOT_YOUR_RIDE', 'This ride is not assigned to you');
  assertTransition(ride.status, 'COMPLETED');

  const finalFare = ride.estimatedFare ?? estimateFare(ride.distanceKm ?? 0);
  await prisma.$transaction([
    prisma.ride.update({
      where: { id: rideId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        finalFare,
        // UPI is simulated: mark paid with a mock reference; cash settles offline.
        paymentStatus: ride.paymentMethod === 'UPI' ? 'PAID' : 'PENDING',
        paymentRef: ride.paymentMethod === 'UPI' ? `UPI-${Date.now().toString(36).toUpperCase()}` : null,
      },
    }),
    prisma.driverProfile.update({
      where: { id: ride.driver!.id },
      data: { status: 'ONLINE', totalRides: { increment: 1 } },
    }),
  ]);

  const updated = await getRide(rideId);
  await logEvent(rideId, 'COMPLETED', 'DRIVER', { finalFare });
  bus.publish('ride.updated', { ride: updated, previousStatus: ride.status });
  bus.publish('driver.presence', { driverId: ride.driver!.id, userId: driverUserId, status: 'ONLINE' });
  return updated;
}

// ───────────────────────────── Cancel / expire ─────────────────────────────

export async function cancelRide(rideId: string, actor: { id: string; role: Role }, reason?: string) {
  const ride = await getRide(rideId);

  const isPassenger = actor.role === 'PASSENGER' && ride.passengerId === actor.id;
  const isDriver = actor.role === 'DRIVER' && ride.driver?.userId === actor.id;
  const isAdmin = actor.role === 'ADMIN';
  if (!isPassenger && !isDriver && !isAdmin) {
    throw new ApiError(403, 'FORBIDDEN', 'You cannot cancel this ride');
  }
  if (isPassenger && ride.status === 'IN_PROGRESS') {
    throw new ApiError(409, 'RIDE_IN_PROGRESS', 'A ride in progress can only be completed by the driver');
  }

  // A driver bailing on an ACCEPTED ride puts it back on the board instead of
  // killing the passenger's request.
  if (isDriver && ride.status === 'ACCEPTED') {
    assertTransition('ACCEPTED', 'REQUESTED');
    await prisma.$transaction([
      prisma.ride.update({
        where: { id: rideId },
        data: { status: 'REQUESTED', driverId: null, acceptedAt: null, requestedAt: new Date() },
      }),
      prisma.driverProfile.update({ where: { id: ride.driver!.id }, data: { status: 'ONLINE' } }),
    ]);
    const updated = await getRide(rideId);
    await logEvent(rideId, 'REASSIGNED', 'DRIVER', { reason: reason ?? 'driver cancelled' });
    bus.publish('ride.updated', { ride: updated, previousStatus: 'ACCEPTED' });
    bus.publish('ride.requested', { ride: updated });
    bus.publish('driver.presence', { driverId: ride.driver!.id, userId: actor.id, status: 'ONLINE' });
    return updated;
  }

  assertTransition(ride.status, 'CANCELLED');
  await prisma.$transaction(async (tx) => {
    await guardedUpdate(
      rideId,
      ride.status,
      {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actor.role,
        cancelReason: reason,
      },
      tx,
    );
    if (ride.driver && ['ACCEPTED', 'IN_PROGRESS'].includes(ride.status)) {
      await tx.driverProfile.update({ where: { id: ride.driver.id }, data: { status: 'ONLINE' } });
    }
  });

  const updated = await getRide(rideId);
  await logEvent(rideId, 'CANCELLED', actor.role, { reason });
  bus.publish('ride.updated', { ride: updated, previousStatus: ride.status });
  bus.publish('ride.unavailable', { rideId, reason: 'CANCELLED' });
  if (ride.driver) bus.publish('driver.presence', { driverId: ride.driver.id, userId: ride.driver.userId, status: 'ONLINE' });
  return updated;
}

/** Expires a ride nobody accepted (called by the dispatch-timeout worker). */
export async function expireRide(rideId: string) {
  const res = await prisma.ride.updateMany({
    where: { id: rideId, status: 'REQUESTED' },
    data: { status: 'EXPIRED', cancelledAt: new Date() },
  });
  if (res.count === 0) return null;
  const ride = await getRide(rideId);
  await logEvent(rideId, 'EXPIRED', undefined, { afterSec: env.RIDE_DISPATCH_TIMEOUT_SEC });
  bus.publish('ride.updated', { ride, previousStatus: 'REQUESTED' });
  bus.publish('ride.unavailable', { rideId, reason: 'EXPIRED' });
  return ride;
}

// ───────────────────────────── Queries ─────────────────────────────

export async function listMyRides(user: { id: string; role: Role }, status?: RideStatus, take = 25) {
  const where: Prisma.RideWhereInput =
    user.role === 'DRIVER'
      ? { driver: { userId: user.id }, ...(status ? { status } : {}) }
      : { passengerId: user.id, ...(status ? { status } : {}) };
  return prisma.ride.findMany({ where, include: rideInclude, orderBy: { createdAt: 'desc' }, take });
}

export async function getActiveRideFor(user: { id: string; role: Role }) {
  const where: Prisma.RideWhereInput =
    user.role === 'DRIVER'
      ? { driver: { userId: user.id }, status: { in: ['ACCEPTED', 'IN_PROGRESS'] } }
      : { passengerId: user.id, status: { in: ACTIVE_STATUSES } };
  return prisma.ride.findFirst({ where, include: rideInclude, orderBy: { createdAt: 'desc' } });
}

/** Open requests visible on the driver dispatch board. */
export async function listOpenRequests() {
  return prisma.ride.findMany({
    where: { status: 'REQUESTED' },
    include: rideInclude,
    orderBy: { requestedAt: 'asc' },
    take: 50,
  });
}

export async function getRideForParticipant(rideId: string, user: { id: string; role: Role }) {
  const ride = await getRide(rideId);
  const allowed =
    user.role === 'ADMIN' ||
    ride.passengerId === user.id ||
    ride.driver?.userId === user.id ||
    (user.role === 'DRIVER' && ride.status === 'REQUESTED');
  if (!allowed) throw new ApiError(403, 'FORBIDDEN', 'You are not part of this ride');
  return ride;
}

// Status-guarded write: refuses to apply if someone changed status first.
async function guardedUpdate(
  rideId: string,
  expectedStatus: RideStatus,
  data: Prisma.RideUpdateManyMutationInput,
  tx: Prisma.TransactionClient = prisma,
) {
  const res = await tx.ride.updateMany({ where: { id: rideId, status: expectedStatus }, data });
  if (res.count === 0) {
    throw new ApiError(409, 'STALE_STATE', 'Ride changed state, refresh and try again');
  }
}
