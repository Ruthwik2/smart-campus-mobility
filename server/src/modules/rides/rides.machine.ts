import type { RideStatus } from '@prisma/client';

/**
 * The ride lifecycle as an explicit state machine.
 *
 *   SCHEDULED ─▶ REQUESTED ─▶ ACCEPTED ─▶ IN_PROGRESS ─▶ COMPLETED
 *       │            │  ▲         │
 *       │            │  └─────────┤  (driver cancels → back on the board)
 *       ▼            ▼            ▼
 *   CANCELLED   CANCELLED /   CANCELLED
 *               EXPIRED
 *
 * Every mutation in rides.service runs through assertTransition, and the
 * DB update itself is guarded with `updateMany({ where: { status: from } })`
 * so a stale client can never force an illegal jump.
 */
export const TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  SCHEDULED: ['REQUESTED', 'CANCELLED'],
  REQUESTED: ['ACCEPTED', 'CANCELLED', 'EXPIRED'],
  ACCEPTED: ['IN_PROGRESS', 'CANCELLED', 'REQUESTED'], // REQUESTED = driver bailed, rebroadcast
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export const ACTIVE_STATUSES: RideStatus[] = ['SCHEDULED', 'REQUESTED', 'ACCEPTED', 'IN_PROGRESS'];

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Illegal ride transition ${from} → ${to}`), {
      status: 409,
      code: 'ILLEGAL_TRANSITION',
    });
  }
}
