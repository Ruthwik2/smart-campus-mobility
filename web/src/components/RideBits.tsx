'use client';

import type { Ride } from '@/lib/types';
import { StatusPill } from './ui';

/** Pickup → drop rendered as a transit route line; fills in as the ride progresses. */
export function RideTimeline({ ride }: { ride: Ride }) {
  const started = ride.status === 'IN_PROGRESS' || ride.status === 'COMPLETED';
  const completed = ride.status === 'COMPLETED';
  return (
    <div className="timeline">
      <span className={`dot ${started ? 'done' : ride.status === 'ACCEPTED' ? 'live' : ''}`} />
      <div className="pb-1">
        <p className="label">Pickup</p>
        <p className="font-display text-[15px] font-semibold leading-tight">{ride.pickupLabel}</p>
      </div>
      <span className={`rail ${started ? 'done' : ''}`} />
      <span />
      <span className={`dot ${completed ? 'done' : started ? 'live' : ''}`} />
      <div>
        <p className="label">Drop</p>
        <p className="font-display text-[15px] font-semibold leading-tight">{ride.dropLabel}</p>
      </div>
    </div>
  );
}

export function FareLine({ ride }: { ride: Ride }) {
  const fare = ride.finalFare ?? ride.estimatedFare;
  return (
    <div className="flex items-baseline justify-between border-t border-dashed border-line pt-3">
      <span className="text-[13px] text-slate2">
        {ride.distanceKm ? `${ride.distanceKm.toFixed(1)} km · ` : ''}
        {ride.paymentMethod}
        {ride.paymentStatus === 'PAID' ? ' · paid' : ''}
      </span>
      <span className="font-mono text-lg font-bold">₹{fare ?? '—'}</span>
    </div>
  );
}

export function OtpChip({ otp }: { otp: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-ink px-4 py-3 text-white">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/60">Start code</p>
        <p className="text-[12px] text-white/80">Show this to your driver at pickup</p>
      </div>
      <span className="font-mono text-2xl font-bold tracking-[0.3em]">{otp}</span>
    </div>
  );
}

export function RideMeta({ ride }: { ride: Ride }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[12px] font-semibold text-slate2">{ride.code}</span>
      <StatusPill status={ride.status} />
    </div>
  );
}

export function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
