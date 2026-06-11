'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CalendarClock, MapPin, Phone, Star } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { FareLine, OtpChip, RideMeta, RideTimeline, formatWhen } from '@/components/RideBits';
import { Empty, Field, Modal, Spinner, Stars, StatusPill, Toggle, ZoneSelect } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { CampusZone, NearbyDriver, Ride } from '@/lib/types';
import { useLive } from '@/stores/live';

const estimate = (km: number) => 20 + Math.round(km * 10);
function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export default function PassengerPage() {
  return (
    <AppShell role="PASSENGER" title="Passenger">
      <PassengerHome />
    </AppShell>
  );
}

function PassengerHome() {
  const { activeRide, setActiveRide, lastTerminal, clearTerminal, unavailableNote, clearUnavailable } = useLive();
  const [zones, setZones] = useState<CampusZone[]>([]);
  const [history, setHistory] = useState<Ride[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const refreshHistory = useCallback(async () => {
    try {
      const { data } = await api.get<{ rides: Ride[] }>('/rides');
      setHistory(data.rides);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void api.get<{ zones: CampusZone[] }>('/zones').then(({ data }) => setZones(data.zones));
    void api.get<{ ride: Ride | null }>('/rides/active').then(({ data }) => setActiveRide(data.ride));
    void refreshHistory();
  }, [setActiveRide, refreshHistory]);

  // Terminal events (completion/cancel) should refresh the list behind the card.
  useEffect(() => {
    if (lastTerminal || !activeRide) void refreshHistory();
  }, [lastTerminal, activeRide, refreshHistory]);

  return (
    <>
      <AnimatePresence>
        {unavailableNote && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card flex items-center justify-between gap-3 border-amber bg-amber-soft px-4 py-3 text-[13px] font-medium"
          >
            <span>{unavailableNote}</span>
            <button className="font-bold underline underline-offset-2" onClick={clearUnavailable}>
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {activeRide ? (
          <motion.div key="active" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <ActiveRideCard ride={activeRide} />
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <RequestForm zones={zones} />
          </motion.div>
        )}
      </AnimatePresence>

      <RatingDialog ride={lastTerminal} onDone={() => { clearTerminal(); void refreshHistory(); }} />

      <section className="space-y-3 pt-2">
        <h2 className="font-display text-lg font-bold">Your rides</h2>
        {loadingHistory ? (
          <div className="card grid place-items-center p-8"><Spinner /></div>
        ) : history.length === 0 ? (
          <Empty title="No rides yet" hint="Your trips will show up here." />
        ) : (
          <div className="space-y-2.5">
            {history.map((r) => <HistoryRow key={r.id} ride={r} onRated={refreshHistory} />)}
          </div>
        )}
      </section>
    </>
  );
}

// ---- Request form ---------------------------------------------------------------
function RequestForm({ zones }: { zones: CampusZone[] }) {
  const { setActiveRide } = useLive();
  const [pickup, setPickup] = useState('');
  const [drop, setDrop] = useState('');
  const [upi, setUpi] = useState(true);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyDriver[] | null>(null);

  const options = zones.map((z) => ({ value: z.name, label: z.name }));
  const from = zones.find((z) => z.name === pickup);
  const to = zones.find((z) => z.name === drop);
  const km = from && to ? haversineKm(from.lat, from.lng, to.lat, to.lng) : null;

  // Show how many verified drivers are near the pickup before requesting.
  useEffect(() => {
    if (!from) return setNearby(null);
    let stale = false;
    void api
      .get<{ drivers: NearbyDriver[] }>('/drivers/nearby', { params: { lat: from.lat, lng: from.lng, radiusKm: 3 } })
      .then(({ data }) => !stale && setNearby(data.drivers))
      .catch(() => !stale && setNearby(null));
    return () => { stale = true; };
  }, [from]);

  const submit = async () => {
    if (!from || !to) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ ride: Ride }>('/rides', {
        pickupLabel: from.name, pickupLat: from.lat, pickupLng: from.lng,
        dropLabel: to.name, dropLat: to.lat, dropLng: to.lng,
        paymentMethod: upi ? 'UPI' : 'CASH',
        ...(later && when ? { scheduledFor: new Date(when).toISOString() } : {}),
      });
      setActiveRide(data.ride);
    } catch (e) {
      setError(errorMessage(e, 'Could not request the ride'));
    } finally {
      setBusy(false);
    }
  };

  const minWhen = useMemo(() => {
    const d = new Date(Date.now() + 20 * 60_000);
    d.setSeconds(0, 0);
    return d.toISOString().slice(0, 16);
  }, []);

  return (
    <div className="card space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Where to?</h2>
        {nearby && (
          <span className="flex items-center gap-1.5 text-[12px] font-semibold text-primary-dark">
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-primary" />
            {nearby.length} driver{nearby.length === 1 ? '' : 's'} nearby
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Pickup">
          <ZoneSelect value={pickup} onChange={setPickup} options={options} placeholder="Choose pickup" />
        </Field>
        <Field label="Destination">
          <ZoneSelect value={drop} onChange={setDrop} options={options.filter((o) => o.value !== pickup)} placeholder="Choose destination" />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2.5 text-[14px] font-medium">
          <Toggle checked={upi} onChange={setUpi} /> Pay by UPI {upi ? '' : '(cash)'}
        </label>
        <label className="flex items-center gap-2.5 text-[14px] font-medium">
          <Toggle checked={later} onChange={setLater} />
          <span className="flex items-center gap-1.5"><CalendarClock className="h-4 w-4 text-slate2" /> Schedule for later</span>
        </label>
      </div>

      {later && (
        <Field label="Pickup time">
          <input type="datetime-local" className="input" min={minWhen} value={when} onChange={(e) => setWhen(e.target.value)} />
        </Field>
      )}

      {km !== null && (
        <div className="flex items-baseline justify-between rounded-lg bg-primary-soft px-4 py-3">
          <span className="text-[13px] font-medium text-primary-dark">{km.toFixed(1)} km · ₹20 base + ₹10/km</span>
          <span className="font-mono text-xl font-bold text-primary-dark">≈ ₹{estimate(km)}</span>
        </div>
      )}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{error}</p>}

      <button className="btn-primary w-full" disabled={!from || !to || busy || (later && !when)} onClick={submit}>
        {busy ? <Spinner /> : later ? 'Schedule ride' : 'Request ride now'}
      </button>
    </div>
  );
}

// ---- Active ride ------------------------------------------------------------------
function ActiveRideCard({ ride }: { ride: Ride }) {
  const { driverLocation, setActiveRide } = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Join the ride room — driver:location is only broadcast to subscribed participants.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('ride:subscribe', { rideId: ride.id });
    return () => {
      socket.emit('ride:unsubscribe', { rideId: ride.id });
    };
  }, [ride.id]);

  const driverKm =
    driverLocation && ride.status === 'ACCEPTED'
      ? haversineKm(driverLocation.lat, driverLocation.lng, ride.pickupLat, ride.pickupLng)
      : null;

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ ride: Ride }>(`/rides/${ride.id}/cancel`, { reason: 'Changed plans' });
      setActiveRide(null);
      void data;
    } catch (e) {
      setError(errorMessage(e, 'Could not cancel'));
    } finally {
      setBusy(false);
    }
  };

  const headline =
    ride.status === 'SCHEDULED' ? `Scheduled for ${formatWhen(ride.scheduledFor)}`
    : ride.status === 'REQUESTED' ? 'Finding you a driver…'
    : ride.status === 'ACCEPTED' ? `${ride.driver?.user.fullName ?? 'Your driver'} is on the way`
    : 'Ride in progress';

  return (
    <div className="card space-y-4 p-5">
      <RideMeta ride={ride} />
      <div className="flex items-center gap-3">
        {ride.status === 'REQUESTED' && <Spinner className="h-5 w-5" />}
        <h2 className="font-display text-lg font-bold leading-tight">{headline}</h2>
      </div>

      <RideTimeline ride={ride} />

      {ride.driver && (ride.status === 'ACCEPTED' || ride.status === 'IN_PROGRESS') && (
        <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
          <div>
            <p className="font-display text-[15px] font-semibold">{ride.driver.user.fullName}</p>
            <p className="text-[12px] text-slate2">
              {ride.driver.vehicleModel}{' '}
              · <span className="font-mono">{ride.driver.vehiclePlate}</span>
              {ride.driver.ratingCount ? (
                <> · <Star className="inline h-3 w-3 fill-amber text-amber" /> {ride.driver.ratingAvg.toFixed(1)}</>
              ) : null}
            </p>
            {driverKm !== null && (
              <p className="mt-0.5 flex items-center gap-1 text-[12px] font-semibold text-primary-dark">
                <MapPin className="h-3 w-3" /> {driverKm < 0.05 ? 'At your pickup point' : `${driverKm.toFixed(2)} km away`}
              </p>
            )}
          </div>
          {ride.driver.user.phone && (
            <a href={`tel:${ride.driver.user.phone}`} className="btn-ghost !px-3 !py-2" aria-label="Call driver">
              <Phone className="h-4 w-4" />
            </a>
          )}
        </div>
      )}

      {ride.startOtp && ride.status === 'ACCEPTED' && <OtpChip otp={ride.startOtp} />}

      <FareLine ride={ride} />

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{error}</p>}

      {ride.status !== 'IN_PROGRESS' && (
        <button className="btn-danger w-full" onClick={cancel} disabled={busy}>
          {busy ? <Spinner /> : 'Cancel ride'}
        </button>
      )}
    </div>
  );
}

// ---- Rating ------------------------------------------------------------------------
function RatingDialog({ ride, onDone }: { ride: Ride | null; onDone: () => void }) {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStars(5); setComment(''); }, [ride?.id]);

  const submit = async () => {
    if (!ride) return;
    setBusy(true);
    try {
      await api.post(`/rides/${ride.id}/rating`, { stars, comment: comment || undefined });
    } finally {
      setBusy(false);
      onDone();
    }
  };

  return (
    <Modal open={Boolean(ride && !ride.rating)} onClose={onDone} title="How was your ride?">
      {ride && (
        <div className="space-y-4">
          <p className="text-[13px] text-slate2">
            {ride.pickupLabel} → {ride.dropLabel} with {ride.driver?.user.fullName} · ₹{ride.finalFare}
            {ride.paymentMethod === 'UPI' && ride.paymentStatus === 'PAID' ? ' paid via UPI' : ''}
          </p>
          <div className="grid place-items-center py-1"><Stars value={stars} onChange={setStars} size="text-3xl" /></div>
          <textarea
            className="input min-h-[72px] resize-none"
            placeholder="Anything to add? (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <button className="btn-ghost flex-1" onClick={onDone}>Skip</button>
            <button className="btn-primary flex-1" onClick={submit} disabled={busy}>
              {busy ? <Spinner /> : 'Submit rating'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---- History row ----------------------------------------------------------------------
function HistoryRow({ ride, onRated }: { ride: Ride; onRated: () => void }) {
  const [rateOpen, setRateOpen] = useState(false);
  return (
    <div className="card flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-display text-[14px] font-semibold">
          {ride.pickupLabel} → {ride.dropLabel}
        </p>
        <p className="text-[12px] text-slate2">
          {formatWhen(ride.requestedAt ?? ride.createdAt)} · <span className="font-mono">{ride.code}</span>
          {ride.finalFare ? ` · ₹${ride.finalFare}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {ride.status === 'COMPLETED' && !ride.rating && (
          <button className="btn-amber !px-3 !py-1.5 !text-[12px]" onClick={() => setRateOpen(true)}>Rate</button>
        )}
        {ride.rating && <span className="text-[13px] font-semibold text-amber">★ {ride.rating.stars}</span>}
        <StatusPill status={ride.status} />
      </div>
      <RatingDialog ride={rateOpen ? ride : null} onDone={() => { setRateOpen(false); onRated(); }} />
    </div>
  );
}
