import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { corsOrigins, env } from '../config/env';
import { bus } from '../lib/bus';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { verifyAccessToken } from '../middleware/auth';
import { markOfflineIfIdle, updateLocation } from '../modules/drivers/drivers.service';

/**
 * Realtime gateway.
 *
 * Room layout (one namespace, role-scoped rooms):
 *   user:{userId}     personal channel (ride updates, notifications)
 *   ride:{rideId}     both ride participants + admins watching
 *   drivers:online    every connected driver — receives the dispatch board feed
 *   admins            ops console live feed
 *
 * REST owns every state mutation (atomicity + uniform authz); sockets carry
 * high-frequency telemetry up (locations) and push state down. The Redis
 * adapter lets several API replicas share one room space behind Nginx.
 */

type AuthedSocket = Socket & { data: { userId: string; role: string } };

const offlineTimers = new Map<string, NodeJS.Timeout>(); // userId → grace timer
const OFFLINE_GRACE_MS = 45_000;

export function initSockets(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/socket.io',
  });

  // Redis pub/sub adapter — required once `api` scales past one replica.
  const pub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const sub = pub.duplicate();
  io.adapter(createAdapter(pub, sub));

  // Handshake auth: same JWT as REST, passed via `auth.token`.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('UNAUTHENTICATED'));
      const payload = verifyAccessToken(token);
      (socket as AuthedSocket).data = { userId: payload.sub, role: payload.role };
      next();
    } catch {
      next(new Error('TOKEN_INVALID'));
    }
  });

  io.on('connection', (raw) => {
    const socket = raw as AuthedSocket;
    const { userId, role } = socket.data;
    socket.join(`user:${userId}`);
    if (role === 'ADMIN') socket.join('admins');
    if (role === 'DRIVER') {
      socket.join('drivers:online');
      // Reconnected within the grace window → keep them online.
      const timer = offlineTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        offlineTimers.delete(userId);
      }
    }
    logger.debug({ userId, role }, 'socket connected');

    // ── Client → server ──────────────────────────────────────────────
    socket.on('ride:subscribe', async ({ rideId }: { rideId: string }) => {
      if (typeof rideId !== 'string') return;
      // Only participants (or admins) may join a ride room.
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { passengerId: true, driver: { select: { userId: true } } },
      });
      const allowed =
        role === 'ADMIN' || ride?.passengerId === userId || ride?.driver?.userId === userId;
      if (allowed) socket.join(`ride:${rideId}`);
    });

    socket.on('ride:unsubscribe', ({ rideId }: { rideId: string }) => {
      if (typeof rideId === 'string') socket.leave(`ride:${rideId}`);
    });

    socket.on('driver:location', async (payload: { lat: number; lng: number }) => {
      if (role !== 'DRIVER') return;
      const { lat, lng } = payload ?? {};
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return;
      await updateLocation(userId, lat, lng).catch((e) => logger.warn(e, 'location update failed'));
    });

    // ── Presence ─────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      if (role !== 'DRIVER') return;
      // Grace period: brief drops (page refresh, network blip) don't yank an
      // ONLINE driver off the board. BUSY drivers are never auto-flipped.
      const timer = setTimeout(() => {
        offlineTimers.delete(userId);
        markOfflineIfIdle(userId).catch((e) => logger.warn(e, 'auto-offline failed'));
      }, OFFLINE_GRACE_MS);
      offlineTimers.set(userId, timer);
    });
  });

  wireDomainEvents(io);
  return io;
}

/** Domain events (published by services) → socket emissions. */
function wireDomainEvents(io: Server) {
  bus.subscribe('ride.requested', ({ ride }) => {
    io.to('drivers:online').emit('ride:requested', { ride });
    io.to('admins').emit('ride:requested', { ride });
    io.to(`user:${ride.passengerId}`).emit('ride:update', { ride });
  });

  bus.subscribe('ride.updated', ({ ride, previousStatus }) => {
    const payload = { ride, previousStatus };
    io.to(`user:${ride.passengerId}`).emit('ride:update', payload);
    const driverUserId = (ride as { driver?: { userId?: string } }).driver?.userId;
    if (driverUserId) io.to(`user:${driverUserId}`).emit('ride:update', payload);
    io.to(`ride:${ride.id}`).emit('ride:update', payload);
    io.to('admins').emit('ride:update', payload);
  });

  bus.subscribe('ride.unavailable', ({ rideId, reason }) => {
    // Tells every driver's dispatch board to drop the card immediately.
    io.to('drivers:online').emit('ride:unavailable', { rideId, reason });
    io.to('admins').emit('ride:unavailable', { rideId, reason });
  });

  bus.subscribe('driver.presence', ({ driverId, status }) => {
    io.to('admins').emit('driver:presence', { driverId, status });
  });

  bus.subscribe('driver.location', ({ driverId, lat, lng, rideId }) => {
    if (rideId) io.to(`ride:${rideId}`).emit('driver:location', { driverId, lat, lng, rideId });
    io.to('admins').emit('driver:location', { driverId, lat, lng, rideId });
  });
}
