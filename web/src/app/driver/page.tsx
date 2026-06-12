'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, FileUp, IndianRupee, MapPin, Phone, Route, Star } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { FareLine, RideMeta, RideTimeline } from '@/components/RideBits';
import { Empty, Field, Spinner, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger, Toggle, ZoneSelect } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { DriverDashboard, Ride } from '@/lib/types';
import { useLive } from '@/stores/live';

/** Centre of the IIT Roorkee campus — anchor for the demo location simulator. */
const CAMPUS = { lat: 29.8655, lng: 77.8951 };

const fmtMoney = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function timeAgo(iso: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

export default function DriverPage() {
  return (
    <AppShell role="DRIVER" title="Driver console">
      <DriverHome />
    </AppShell>
  );
}

function DriverHome() {
  const { activeRide, setActiveRide, setOpenRequests } = useLive();
  const [dash, setDash] = useState<DriverDashboard | null>(null);

  const refreshDash = useCallback(async () => {
    try {
      const { data } = await api.get<DriverDashboard>('/drivers/me/dashboard');
      setDash(data);
    } catch {
      /* transient; the shell will have redirected if auth is the issue */
    }
  }, []);

  const refreshBoard = useCallback(async () => {
    try {
      const { data } = await api.get<{ rides: Ride[] }>('/rides/open');
      setOpenRequests(data.rides);
    } catch {
      /* board stays as-is */
    }
  }, [setOpenRequests]);

  // Boot: profile + stats, then any ride already in flight (e.g. after a refresh mid-trip).
  useEffect(() => {
    void refreshDash();
    void api
      .get<{ ride: Ride | null }>('/rides/active')
      .then(({ data }) => {
        if (data.ride) setActiveRide(data.ride);
      })
      .catch(() => {});
  }, [refreshDash, setActiveRide]);

  const profile = dash?.profile ?? null;
  const verified = profile?.verificationStatus === 'APPROVED';
  const streaming = profile?.status === 'ONLINE' || profile?.status === 'BUSY';

  // Seed the dispatch board whenever we come online.
  useEffect(() => {
    if (verified && streaming) void refreshBoard();
  }, [verified, streaming, refreshBoard]);

  // When the active ride ends (completed / cancelled / bailed), resync profile + stats + board.
  const prevRideId = useRef<string | null>(null);
  useEffect(() => {
    const id = activeRide?.id ?? null;
    if (prevRideId.current && !id) {
      void refreshDash();
      void refreshBoard();
    }
    prevRideId.current = id;
  }, [activeRide, refreshDash, refreshBoard]);

  useLocationBeacon(Boolean(verified && streaming), activeRide);

  if (!dash || !profile) {
    return (
      <div className="grid place-items-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!verified && <VerificationBanner dash={dash} />}

      <AvailabilityCard dash={dash} onProfile={(p) => setDash({ ...dash, profile: p })} />

      <Tabs defaultValue="dispatch">
        <TabsList>
          <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="dispatch" className="mt-4 space-y-4">
          {activeRide ? (
            <ActiveJobCard ride={activeRide} />
          ) : verified && streaming ? (
            <OpenBoard />
          ) : (
            <Empty
              title={verified ? 'You are offline' : 'Verification pending'}
              hint={
                verified
                  ? 'Flip the switch above to start receiving ride requests.'
                  : 'Once the transport office approves your documents you can go online.'
              }
            />
          )}
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <PerformancePanel dash={dash} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Location beacon ---------------------------------------------------------------
/**
 * While online, stream `driver:location` over the socket.
 * Real GPS via watchPosition when the browser grants it; otherwise a campus
 * simulator that drifts toward the pickup (ACCEPTED) or destination (IN_PROGRESS)
 * so live tracking is demonstrable on any machine.
 */
function useLocationBeacon(active: boolean, ride: Ride | null) {
  const pos = useRef({ ...CAMPUS });
  const rideRef = useRef<Ride | null>(ride);
  rideRef.current = ride;

  useEffect(() => {
    if (!active) return;
    const socket = getSocket();
    if (!socket) return;

    let gpsAlive = false;
    let lastEmit = 0;
    const emit = (lat: number, lng: number) => {
      pos.current = { lat, lng };
      socket.emit('driver:location', { lat, lng });
    };

    let watchId: number | null = null;
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (p) => {
          gpsAlive = true;
          const now = Date.now();
          if (now - lastEmit > 3500) {
            lastEmit = now;
            emit(p.coords.latitude, p.coords.longitude);
          }
        },
        () => {
          gpsAlive = false; // denied / unavailable → simulator takes over
        },
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    }

    const timer = setInterval(() => {
      if (gpsAlive) return;
      const r = rideRef.current;
      const target =
        r?.status === 'ACCEPTED'
          ? { lat: r.pickupLat, lng: r.pickupLng }
          : r?.status === 'IN_PROGRESS'
            ? { lat: r.dropLat, lng: r.dropLng }
            : null;
      const cur = pos.current;
      const next = target
        ? {
            lat: cur.lat + (target.lat - cur.lat) * 0.18,
            lng: cur.lng + (target.lng - cur.lng) * 0.18,
          }
        : {
            lat: cur.lat + (Math.random() - 0.5) * 0.0008,
            lng: cur.lng + (Math.random() - 0.5) * 0.0008,
          };
      emit(next.lat, next.lng);
    }, 4000);

    return () => {
      if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
      clearInterval(timer);
    };
  }, [active]);
}

// ---- Verification ------------------------------------------------------------------
const DOC_TYPES = [
  { value: 'LICENSE', label: 'Driving license' },
  { value: 'VEHICLE_RC', label: 'Vehicle RC' },
  { value: 'ID_PROOF', label: 'ID proof' },
];

function VerificationBanner({ dash }: { dash: DriverDashboard }) {
  const rejected = dash.profile.verificationStatus === 'REJECTED';
  const [type, setType] = useState('LICENSE');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('type', type);
      form.append('file', file);
      await api.post('/drivers/me/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      setSent((s) => Array.from(new Set([...s, type])));
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      setError(errorMessage(e, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`card space-y-3 border p-5 ${rejected ? 'border-danger/40 bg-danger-soft' : 'border-amber/50 bg-amber-soft'}`}>
      <div>
        <p className="font-display text-[15px] font-bold">
          {rejected ? 'Verification rejected' : 'Verification pending'}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-slate2">
          {rejected
            ? dash.profile.verificationNote || 'The transport office rejected your documents. Re-upload and we will take another look.'
            : 'Upload your documents below. The transport office reviews them before you can go online.'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label="Document">
            <ZoneSelect value={type} onChange={setType} options={DOC_TYPES} placeholder="Type" />
          </Field>
        </div>
        <label className="btn-ghost cursor-pointer !bg-white">
          <FileUp className="h-4 w-4" />
          <span className="max-w-[140px] truncate">{file ? file.name : 'Choose file'}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button className="btn-primary" onClick={upload} disabled={!file || busy}>
          {busy ? <Spinner /> : 'Upload'}
        </button>
      </div>

      {sent.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] font-medium text-primary-dark">
          {sent.map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> {DOC_TYPES.find((d) => d.value === t)?.label} submitted
            </span>
          ))}
        </p>
      )}
      {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
    </div>
  );
}

// ---- Availability ------------------------------------------------------------------
function AvailabilityCard({
  dash,
  onProfile,
}: {
  dash: DriverDashboard;
  onProfile: (p: DriverDashboard['profile']) => void;
}) {
  const { profile } = dash;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onlineish = profile.status === 'ONLINE' || profile.status === 'BUSY';

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.patch<{ profile: DriverDashboard['profile'] }>('/drivers/me/availability', {
        status: next ? 'ONLINE' : 'OFFLINE',
      });
      onProfile(data.profile);
    } catch (e) {
      setError(errorMessage(e, 'Could not update availability'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
      <div className="flex items-center gap-3">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            profile.status === 'BUSY' ? 'bg-amber' : profile.status === 'ONLINE' ? 'animate-pulse-dot bg-primary' : 'bg-line'
          }`}
        />
        <div>
          <p className="font-display text-[15px] font-bold leading-tight">
            {profile.status === 'BUSY' ? 'On a ride' : profile.status === 'ONLINE' ? 'Online — listening for requests' : 'Offline'}
          </p>
          <p className="text-[12px] text-slate2">
            {profile.vehicleModel} · <span className="font-mono">{profile.vehiclePlate}</span>
            {profile.ratingCount > 0 && (
              <>
                {' '}· <Star className="inline h-3 w-3 fill-amber text-amber" /> {profile.ratingAvg.toFixed(1)} ({profile.ratingCount})
              </>
            )}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {busy && <Spinner />}
        <Toggle checked={onlineish} onChange={toggle} disabled={busy || profile.status === 'BUSY'} />
      </div>
      {error && <p className="w-full text-[13px] font-medium text-danger">{error}</p>}
    </div>
  );
}

// ---- Open request board ------------------------------------------------------------
function OpenBoard() {
  const { openRequests, unavailableNote, clearUnavailable, setActiveRide } = useLive();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Open requests</h2>
        <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[12px] font-semibold text-primary-dark">
          {openRequests.length} waiting
        </span>
      </div>

      {unavailableNote && (
        <button
          onClick={clearUnavailable}
          className="w-full rounded-lg bg-amber-soft px-3 py-2 text-left text-[13px] font-medium text-[#6a5200]"
        >
          {unavailableNote} <span className="opacity-60">— tap to dismiss</span>
        </button>
      )}

      {openRequests.length === 0 ? (
        <Empty title="No open requests right now" hint="New requests appear here in real time." />
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {openRequests.map((r) => (
              <RequestCard key={r.id} ride={r} onAccepted={setActiveRide} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function RequestCard({ ride, onAccepted }: { ride: Ride; onAccepted: (r: Ride) => void }) {
  const { setOpenRequests, openRequests } = useLive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.post<{ ride: Ride }>(`/rides/${ride.id}/accept`);
      onAccepted(data.ride);
    } catch (e) {
      // RIDE_TAKEN race → the card simply leaves the board.
      setOpenRequests(openRequests.filter((r) => r.id !== ride.id));
      setError(errorMessage(e, 'Could not accept'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.18 }}
      className="card space-y-3 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold">
            {ride.pickupLabel} <ArrowRight className="inline h-3.5 w-3.5 text-slate2" /> {ride.dropLabel}
          </p>
          <p className="mt-0.5 text-[12px] text-slate2">
            {ride.passenger?.fullName} · requested {timeAgo(ride.createdAt)}
          </p>
        </div>
        <StatusPill status={ride.status} />
      </div>

      <div className="flex items-center gap-4 text-[13px] font-medium text-slate2">
        <span className="inline-flex items-center gap-1">
          <Route className="h-3.5 w-3.5" /> {(ride.distanceKm ?? 0).toFixed(1)} km
        </span>
        <span className="inline-flex items-center gap-1 text-primary-dark">
          <IndianRupee className="h-3.5 w-3.5" /> {ride.estimatedFare} est.
        </span>
        {ride.paymentMethod === 'UPI' && <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-primary-dark">UPI</span>}
      </div>

      {error && <p className="text-[12px] font-medium text-danger">{error}</p>}

      <button className="btn-primary w-full" onClick={accept} disabled={busy}>
        {busy ? <Spinner /> : 'Accept ride'}
      </button>
    </motion.div>
  );
}

// ---- Active job --------------------------------------------------------------------
function ActiveJobCard({ ride }: { ride: Ride }) {
  const { setActiveRide } = useLive();
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (action: 'start' | 'complete' | 'cancel') => {
    setBusy(action);
    setError(null);
    try {
      const body = action === 'start' ? { otp } : action === 'cancel' ? { reason: 'Driver unavailable' } : {};
      const { data } = await api.post<{ ride: Ride }>(`/rides/${ride.id}/${action}`, body);
      if (action === 'cancel') setActiveRide(null);
      else setActiveRide(data.ride);
      if (action === 'start') setOtp('');
    } catch (e) {
      setError(errorMessage(e, 'Action failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="card space-y-4 p-5">
      <RideMeta ride={ride} />
      <h2 className="font-display text-lg font-bold leading-tight">
        {ride.status === 'ACCEPTED'
          ? 'Head to the pickup point'
          : ride.status === 'COMPLETED'
            ? 'Ride completed'
            : 'Trip in progress'}
      </h2>

      <RideTimeline ride={ride} />

      <div className="flex items-center justify-between rounded-lg border border-line px-4 py-3">
        <div>
          <p className="font-display text-[15px] font-semibold">{ride.passenger?.fullName}</p>
          <p className="flex items-center gap-1 text-[12px] text-slate2">
            <MapPin className="h-3 w-3" /> {ride.pickupLabel}
          </p>
        </div>
        {ride.passenger?.phone && (
          <a href={`tel:${ride.passenger.phone}`} className="btn-ghost !px-3 !py-2" aria-label="Call passenger">
            <Phone className="h-4 w-4" />
          </a>
        )}
      </div>

      {ride.status === 'ACCEPTED' && (
        <div className="space-y-2 rounded-lg bg-primary-soft p-4">
          <p className="text-[13px] font-semibold text-primary-dark">Ask the passenger for their 4-digit start code</p>
          <div className="flex gap-2">
            <input
              className="input flex-1 text-center font-mono text-lg tracking-[0.5em]"
              inputMode="numeric"
              maxLength={4}
              placeholder="••••"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
            />
            <button className="btn-primary" onClick={() => call('start')} disabled={otp.length !== 4 || busy !== null}>
              {busy === 'start' ? <Spinner /> : 'Start trip'}
            </button>
          </div>
        </div>
      )}

      <FareLine ride={ride} />

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] font-medium text-danger">{error}</p>}

      {ride.status === 'COMPLETED' ? (
        <button className="btn-primary w-full" onClick={() => setActiveRide(null)}>
          Done — back to the board
        </button>
      ) : ride.status === 'IN_PROGRESS' ? (
        <button className="btn-primary w-full" onClick={() => call('complete')} disabled={busy !== null}>
          {busy === 'complete' ? <Spinner /> : 'Complete ride'}
        </button>
      ) : (
        <button className="btn-danger w-full" onClick={() => call('cancel')} disabled={busy !== null}>
          {busy === 'cancel' ? <Spinner /> : 'Release ride back to the board'}
        </button>
      )}
    </motion.div>
  );
}

// ---- Performance -------------------------------------------------------------------
function PerformancePanel({ dash }: { dash: DriverDashboard }) {
  const { stats, daily, ratingBreakdown, recentRides } = dash;
  const maxStars = Math.max(1, ...ratingBreakdown.map((r) => r.count));

  const tiles = [
    { label: 'Today', value: `${stats.todayRides} rides`, sub: fmtMoney(stats.todayEarnings) },
    { label: 'All time', value: `${stats.totalRides} rides`, sub: fmtMoney(stats.totalEarnings) },
    { label: 'Distance', value: `${stats.totalDistanceKm} km`, sub: 'completed trips' },
    {
      label: 'Rating',
      value: stats.ratingCount ? stats.ratingAvg.toFixed(2) : '—',
      sub: stats.ratingCount ? `${stats.ratingCount} ratings` : 'no ratings yet',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <p className="label">{t.label}</p>
            <p className="mt-1 font-display text-xl font-bold leading-none">{t.value}</p>
            <p className="mt-1 text-[12px] text-slate2">{t.sub}</p>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <p className="font-display text-[15px] font-bold">Last 14 days</p>
        <p className="mb-3 text-[12px] text-slate2">Completed rides (bars) and earnings (line)</p>
        {daily.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-slate2">Complete your first ride to see trends.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#E2E1DA" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tickFormatter={(d: string) => d.slice(5)}
                  tick={{ fontSize: 11, fill: '#5A6B61' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis yAxisId="rides" tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis yAxisId="earn" orientation="right" hide />
                <Tooltip
                  formatter={(v: number, name: string) => (name === 'earnings' ? [fmtMoney(v), 'Earnings'] : [v, 'Rides'])}
                  labelStyle={{ fontSize: 12 }}
                  contentStyle={{ borderRadius: 10, border: '1px solid #E2E1DA', fontSize: 12 }}
                />
                <Bar yAxisId="rides" dataKey="rides" fill="#0E7A4E" radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Line yAxisId="earn" dataKey="earnings" stroke="#F2B807" strokeWidth={2.5} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-5">
          <p className="mb-3 font-display text-[15px] font-bold">Rating breakdown</p>
          <div className="space-y-2">
            {ratingBreakdown.map((r) => (
              <div key={r.stars} className="flex items-center gap-2 text-[12px]">
                <span className="w-7 font-semibold text-slate2">{r.stars}★</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper">
                  <div className="h-full rounded-full bg-amber" style={{ width: `${(r.count / maxStars) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-mono text-slate2">{r.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-5">
          <p className="mb-3 font-display text-[15px] font-bold">Recent rides</p>
          {recentRides.length === 0 ? (
            <p className="text-[13px] text-slate2">Nothing here yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recentRides.slice(0, 6).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-[13px]">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.pickupLabel} → {r.dropLabel}
                    </p>
                    <p className="text-[11px] text-slate2">{r.passenger?.fullName}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.rating && (
                      <span className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-amber">
                        <Star className="h-3 w-3 fill-amber" /> {r.rating.stars}
                      </span>
                    )}
                    <StatusPill status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
