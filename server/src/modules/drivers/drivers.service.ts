import type { DriverStatus } from '@prisma/client';
import { bus } from '../../lib/bus';
import { prisma } from '../../lib/prisma';
import { GEO_DRIVERS_KEY, redis } from '../../lib/redis';
import { ApiError } from '../../middleware/error';

// ─────────────────────────── Availability ───────────────────────────

export async function setAvailability(userId: string, status: Extract<DriverStatus, 'ONLINE' | 'OFFLINE'>) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) throw new ApiError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');
  if (status === 'ONLINE' && profile.verificationStatus !== 'APPROVED') {
    throw new ApiError(403, 'NOT_VERIFIED', 'You can go online once an admin approves your documents');
  }
  if (profile.status === 'BUSY') {
    throw new ApiError(409, 'ON_RIDE', 'Finish your active ride before changing availability');
  }

  const updated = await prisma.driverProfile.update({ where: { userId }, data: { status } });
  if (status === 'OFFLINE') await redis.zrem(GEO_DRIVERS_KEY, profile.id);
  bus.publish('driver.presence', { driverId: profile.id, userId, status });
  return updated;
}

/** Safety net for dropped sockets: only flips ONLINE→OFFLINE, never interrupts a ride. */
export async function markOfflineIfIdle(userId: string) {
  const res = await prisma.driverProfile.updateMany({
    where: { userId, status: 'ONLINE' },
    data: { status: 'OFFLINE' },
  });
  if (res.count > 0) {
    const profile = await prisma.driverProfile.findUnique({ where: { userId }, select: { id: true } });
    if (profile) {
      await redis.zrem(GEO_DRIVERS_KEY, profile.id);
      bus.publish('driver.presence', { driverId: profile.id, userId, status: 'OFFLINE' });
    }
  }
}

// ─────────────────────────── Location ───────────────────────────

/**
 * High-frequency writes go to Redis GEO (cheap, in-memory); Postgres gets a
 * throttled copy (~every 10 s per driver) for cold starts and history.
 */
export async function updateLocation(userId: string, lat: number, lng: number) {
  const profile = await prisma.driverProfile.findUnique({
    where: { userId },
    select: { id: true, status: true, lastLocationAt: true },
  });
  if (!profile || profile.status === 'OFFLINE') return null;

  await redis.geoadd(GEO_DRIVERS_KEY, lng, lat, profile.id);

  const stale = !profile.lastLocationAt || Date.now() - profile.lastLocationAt.getTime() > 10_000;
  if (stale) {
    await prisma.driverProfile.update({
      where: { id: profile.id },
      data: { currentLat: lat, currentLng: lng, lastLocationAt: new Date() },
    });
  }

  const activeRide = await prisma.ride.findFirst({
    where: { driverId: profile.id, status: { in: ['ACCEPTED', 'IN_PROGRESS'] } },
    select: { id: true },
  });
  bus.publish('driver.location', { driverId: profile.id, lat, lng, rideId: activeRide?.id ?? null });
  return profile.id;
}

// ─────────────────────────── Discovery ───────────────────────────

/** Available (ONLINE, approved) drivers near a point — Redis GEO first, DB fallback. */
export async function nearbyDrivers(lat: number, lng: number, radiusKm = 5) {
  let ids: string[] = [];
  try {
    const res = (await redis.geosearch(
      GEO_DRIVERS_KEY,
      'FROMLONLAT', lng, lat,
      'BYRADIUS', radiusKm, 'km',
      'ASC', 'COUNT', 25,
    )) as string[];
    ids = res;
  } catch {
    ids = [];
  }

  const where = ids.length
    ? { id: { in: ids }, status: 'ONLINE' as const, verificationStatus: 'APPROVED' as const }
    : { status: 'ONLINE' as const, verificationStatus: 'APPROVED' as const };

  const drivers = await prisma.driverProfile.findMany({
    where,
    select: {
      id: true,
      vehicleType: true,
      vehicleModel: true,
      vehiclePlate: true,
      capacity: true,
      ratingAvg: true,
      ratingCount: true,
      currentLat: true,
      currentLng: true,
      user: { select: { fullName: true, avatarUrl: true } },
    },
    take: 25,
  });
  // Preserve Redis distance ordering when we have it.
  if (ids.length) drivers.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return drivers;
}

// ─────────────────────────── Dashboard analytics ───────────────────────────

export async function driverDashboard(userId: string) {
  const profile = await prisma.driverProfile.findUnique({ where: { userId } });
  if (!profile) throw new ApiError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found');

  const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayAgg, totalAgg, recentRides, daily, ratingRows] = await Promise.all([
    prisma.ride.aggregate({
      where: { driverId: profile.id, status: 'COMPLETED', completedAt: { gte: startOfToday } },
      _count: true,
      _sum: { finalFare: true },
    }),
    prisma.ride.aggregate({
      where: { driverId: profile.id, status: 'COMPLETED' },
      _count: true,
      _sum: { finalFare: true, distanceKm: true },
    }),
    prisma.ride.findMany({
      where: { driverId: profile.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { passenger: { select: { fullName: true } }, rating: true },
    }),
    // Rides & earnings per day for the trend chart.
    prisma.$queryRaw<{ day: Date; rides: bigint; earnings: bigint | null }[]>`
      SELECT date_trunc('day', "completedAt") AS day,
             COUNT(*) AS rides,
             SUM("finalFare") AS earnings
      FROM rides
      WHERE "driverId" = ${profile.id}
        AND status = 'COMPLETED'
        AND "completedAt" >= ${since14d}
      GROUP BY 1 ORDER BY 1`,
    prisma.rating.groupBy({
      by: ['stars'],
      where: { driverId: profile.id },
      _count: { stars: true },
    }),
  ]);

  return {
    profile,
    stats: {
      totalRides: totalAgg._count,
      totalEarnings: Number(totalAgg._sum.finalFare ?? 0),
      totalDistanceKm: Number((totalAgg._sum.distanceKm ?? 0).toFixed(1)),
      todayRides: todayAgg._count,
      todayEarnings: Number(todayAgg._sum.finalFare ?? 0),
      ratingAvg: profile.ratingAvg,
      ratingCount: profile.ratingCount,
    },
    daily: daily.map((d) => ({
      day: d.day.toISOString().slice(0, 10),
      rides: Number(d.rides),
      earnings: Number(d.earnings ?? 0),
    })),
    ratingBreakdown: [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: ratingRows.find((r) => r.stars === stars)?._count.stars ?? 0,
    })),
    recentRides,
  };
}
