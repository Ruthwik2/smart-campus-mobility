import { describe, it, expect } from 'vitest';
import { TRANSITIONS, ACTIVE_STATUSES, assertTransition } from '../src/modules/rides/rides.machine';
import { RideStatus } from '@prisma/client';

describe('ride state machine', () => {
  it('allows the happy path: REQUESTED → ACCEPTED → IN_PROGRESS → COMPLETED', () => {
    expect(() => assertTransition(RideStatus.REQUESTED, RideStatus.ACCEPTED)).not.toThrow();
    expect(() => assertTransition(RideStatus.ACCEPTED, RideStatus.IN_PROGRESS)).not.toThrow();
    expect(() => assertTransition(RideStatus.IN_PROGRESS, RideStatus.COMPLETED)).not.toThrow();
  });

  it('allows scheduled rides to be promoted to REQUESTED', () => {
    expect(() => assertTransition(RideStatus.SCHEDULED, RideStatus.REQUESTED)).not.toThrow();
  });

  it('allows a driver to bail on an ACCEPTED ride (back to REQUESTED)', () => {
    expect(TRANSITIONS[RideStatus.ACCEPTED]).toContain(RideStatus.REQUESTED);
  });

  it('rejects skipping straight from REQUESTED to IN_PROGRESS', () => {
    expect(() => assertTransition(RideStatus.REQUESTED, RideStatus.IN_PROGRESS)).toThrow();
  });

  it('rejects any transition out of terminal states', () => {
    for (const terminal of [RideStatus.COMPLETED, RideStatus.CANCELLED, RideStatus.EXPIRED]) {
      expect(TRANSITIONS[terminal]).toEqual([]);
      expect(() => assertTransition(terminal, RideStatus.REQUESTED)).toThrow();
    }
  });

  it('rejects cancelling a completed ride', () => {
    expect(() => assertTransition(RideStatus.COMPLETED, RideStatus.CANCELLED)).toThrow();
  });

  it('treats only SCHEDULED/REQUESTED/ACCEPTED/IN_PROGRESS as active', () => {
    expect(ACTIVE_STATUSES.sort()).toEqual(
      [RideStatus.SCHEDULED, RideStatus.REQUESTED, RideStatus.ACCEPTED, RideStatus.IN_PROGRESS].sort(),
    );
  });

  it('only REQUESTED can expire', () => {
    const sources = (Object.keys(TRANSITIONS) as RideStatus[]).filter((s) =>
      TRANSITIONS[s].includes(RideStatus.EXPIRED),
    );
    expect(sources).toEqual([RideStatus.REQUESTED]);
  });
});
