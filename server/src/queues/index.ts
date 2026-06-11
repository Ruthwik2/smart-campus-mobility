import { Queue, Worker } from 'bullmq';
import { bullConnection } from '../lib/redis';
import { logger } from '../lib/logger';
import { env } from '../config/env';
import { expireRide, dispatchScheduledRide } from '../modules/rides/rides.service';
import { recomputeForecasts } from '../modules/admin/admin.service';

/**
 * Background jobs run in-process with the API server. At campus scale
 * (hundreds of rides/day) this is the right trade-off: one deployable,
 * no worker fleet. BullMQ still gives us durable, Redis-backed delayed
 * jobs, so a server restart never loses a pending expiry or scheduled
 * dispatch. If load ever demands it, these workers can be lifted into
 * a separate process without touching call sites.
 */

const QUEUE_NAMES = {
  rideExpiry: 'ride-expiry',
  scheduledRides: 'scheduled-rides',
  forecasts: 'forecasts',
} as const;

const defaultJobOptions = {
  removeOnComplete: { age: 24 * 3600, count: 500 },
  removeOnFail: { age: 7 * 24 * 3600 },
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5_000 },
};

const rideExpiryQueue = new Queue(QUEUE_NAMES.rideExpiry, {
  connection: bullConnection,
  defaultJobOptions,
});

const scheduledRidesQueue = new Queue(QUEUE_NAMES.scheduledRides, {
  connection: bullConnection,
  defaultJobOptions,
});

const forecastsQueue = new Queue(QUEUE_NAMES.forecasts, {
  connection: bullConnection,
  defaultJobOptions,
});

/**
 * When a ride enters REQUESTED, give drivers a fixed window to accept.
 * If nobody does, the job flips it to EXPIRED so passengers aren't left
 * staring at a spinner forever. Job id = ride id keeps it idempotent —
 * re-requesting after a driver bails simply re-uses/replaces the job.
 */
export async function scheduleDispatchTimeout(rideId: string) {
  await rideExpiryQueue.add(
    'expire',
    { rideId },
    { delay: env.RIDE_DISPATCH_TIMEOUT_SEC * 1000, jobId: `expire:${rideId}:${Date.now()}` },
  );
}

/**
 * SCHEDULED rides sit dormant until shortly before their slot, then get
 * promoted to REQUESTED and broadcast to online drivers. We dispatch
 * SCHEDULED_DISPATCH_LEAD_MIN early so a driver has time to accept and
 * reach the pickup point by the requested time.
 */
export async function scheduleFutureRide(rideId: string, scheduledFor: Date) {
  const fireAt = scheduledFor.getTime() - env.SCHEDULED_DISPATCH_LEAD_MIN * 60_000;
  const delay = Math.max(0, fireAt - Date.now());
  await scheduledRidesQueue.add('dispatch', { rideId }, { delay, jobId: `dispatch:${rideId}` });
}

export function initQueues() {
  const workers = [
    new Worker<{ rideId: string }>(
      QUEUE_NAMES.rideExpiry,
      async (job) => {
        // expireRide is a guarded no-op unless the ride is still REQUESTED.
        await expireRide(job.data.rideId);
      },
      { connection: bullConnection },
    ),

    new Worker<{ rideId: string }>(
      QUEUE_NAMES.scheduledRides,
      async (job) => {
        const ride = await dispatchScheduledRide(job.data.rideId);
        // Once live, the normal acceptance window applies.
        if (ride) await scheduleDispatchTimeout(ride.id);
      },
      { connection: bullConnection },
    ),

    new Worker(
      QUEUE_NAMES.forecasts,
      async () => {
        await recomputeForecasts(24);
      },
      { connection: bullConnection },
    ),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      logger.error({ queue: w.name, jobId: job?.id, err: err.message }, 'job failed');
    });
  }

  // Refresh the demand forecast hourly, and once at boot so a fresh
  // database (post-seed) has predictions immediately.
  void forecastsQueue.upsertJobScheduler('hourly-forecast', { every: 60 * 60 * 1000 }, { name: 'recompute' });
  void forecastsQueue.add('recompute-boot', {}, { jobId: `boot:${Date.now()}` });

  logger.info('background queues initialised');

  return async function closeQueues() {
    await Promise.allSettled([
      ...workers.map((w) => w.close()),
      rideExpiryQueue.close(),
      scheduledRidesQueue.close(),
      forecastsQueue.close(),
    ]);
  };
}
