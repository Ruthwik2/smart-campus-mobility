'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, FileText, RefreshCcw, XCircle } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AppShell } from '@/components/AppShell';
import { Empty, Spinner, StatusPill, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { API_URL, api, errorMessage } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import type { Ride, RideStatus, VehicleType } from '@/lib/types';

// ---- Admin-only response shapes (kept local; nothing else consumes them) ------------
interface Overview {
  todayCounts: Partial<Record<RideStatus, number>>;
  totalToday: number;
  completionRateToday: number;
  activeRides: number;
  onlineDrivers: number;
  pendingDrivers: number;
  avgWaitSec: number;
  totalUsers: number;
}

/** Minimal row shape — satisfied by both /admin/rides/live and full socket payloads. */
interface LiveRide {
  id: string;
  status: RideStatus;
  pickupLabel: string;
  dropLabel: string;
  requestedAt: string;
  estimatedFare: number;
  passenger?: { fullName: string } | null;
  driver?: { vehiclePlate: string; user: { fullName: string } } | null;
}

interface PendingDriver {
  id: string;
  licenseNumber: string;
  vehicleType: VehicleType;
  vehicleModel: string;
  vehiclePlate: string;
  capacity: number;
  verificationStatus: string;
  user: { fullName: string; email: string; phone?: string | null };
  documents: { id: string; type: string; fileUrl: string; uploadedAt: string }[];
}

interface DemandReport {
  windowDays: number;
  byHour: { hour: number; rides: number }[];
  byWeekday: { day: string; rides: number }[];
  hotspots: { zone: string; rides: number }[];
  peakHour: { hour: number; rides: number };
}

interface ForecastSlot {
  forHour: string;
  total: number;
  topZones: { zone: string; rides: number }[];
}

const TERMINAL = new Set<RideStatus>(['COMPLETED', 'CANCELLED', 'EXPIRED']);

const fmtWait = (s: number) => (s < 120 ? `${s}s` : `${(s / 60).toFixed(1)} min`);
const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;
const timeAgo = (iso: string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};
const docHref = (url: string) => (url.startsWith('/') ? `${API_URL}${url}` : url);

export default function AdminPage() {
  return (
    <AppShell role="ADMIN" title="Operations">
      <AdminHome />
    </AppShell>
  );
}

function AdminHome() {
  const [overview, setOverview] = useState<Overview | null>(null);

  const refreshOverview = useCallback(async () => {
    try {
      const { data } = await api.get<Overview>('/admin/overview');
      setOverview(data);
    } catch {
      /* keep last good numbers */
    }
  }, []);

  // Poll lazily; sockets nudge an immediate refresh below.
  useEffect(() => {
    void refreshOverview();
    const t = setInterval(refreshOverview, 30_000);
    return () => clearInterval(t);
  }, [refreshOverview]);

  // Any ride/presence movement → debounce a single overview refetch.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const nudge = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(refreshOverview, 1000);
    };
    socket.on('ride:update', nudge);
    socket.on('ride:requested', nudge);
    socket.on('driver:presence', nudge);
    return () => {
      socket.off('ride:update', nudge);
      socket.off('ride:requested', nudge);
      socket.off('driver:presence', nudge);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [refreshOverview]);

  return (
    <div className="space-y-4">
      <OverviewTiles overview={overview} />

      <Tabs defaultValue="ops">
        <TabsList>
          <TabsTrigger value="ops">Live ops</TabsTrigger>
          <TabsTrigger value="demand">Demand</TabsTrigger>
          <TabsTrigger value="forecast">Forecast</TabsTrigger>
        </TabsList>

        <TabsContent value="ops" className="mt-4 space-y-4">
          <LiveRidesTable />
          <VerificationQueue onChanged={refreshOverview} />
        </TabsContent>

        <TabsContent value="demand" className="mt-4">
          <DemandPanel />
        </TabsContent>

        <TabsContent value="forecast" className="mt-4">
          <ForecastPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- KPI tiles -----------------------------------------------------------------------
function OverviewTiles({ overview }: { overview: Overview | null }) {
  const tiles = overview
    ? [
        { label: 'Active rides', value: String(overview.activeRides), sub: 'requested · accepted · in progress' },
        { label: 'Drivers online', value: String(overview.onlineDrivers), sub: `${overview.pendingDrivers} pending verification` },
        { label: 'Rides today', value: String(overview.totalToday), sub: `${overview.completionRateToday}% completed` },
        { label: 'Avg pickup wait', value: overview.avgWaitSec ? fmtWait(overview.avgWaitSec) : '—', sub: 'last 7 days' },
        { label: 'Total users', value: String(overview.totalUsers), sub: 'passengers · drivers · staff' },
      ]
    : Array.from({ length: 5 }, () => null);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((t, i) =>
        t ? (
          <div key={t.label} className="card p-4">
            <p className="label">{t.label}</p>
            <p className="mt-1 font-display text-2xl font-bold leading-none">{t.value}</p>
            <p className="mt-1 text-[11px] leading-snug text-slate2">{t.sub}</p>
          </div>
        ) : (
          <div key={i} className="card h-[92px] animate-pulse p-4" />
        ),
      )}
    </div>
  );
}

// ---- Live rides ------------------------------------------------------------------------
function LiveRidesTable() {
  const [rides, setRides] = useState<LiveRide[] | null>(null);

  useEffect(() => {
    void api
      .get<{ rides: LiveRide[] }>('/admin/rides/live')
      .then(({ data }) => setRides(data.rides))
      .catch(() => setRides([]));
  }, []);

  // Socket payloads carry the full ride object, which structurally covers LiveRide.
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const upsert = ({ ride }: { ride: Ride }) => {
      setRides((rows) => {
        if (!rows) return rows;
        const rest = rows.filter((r) => r.id !== ride.id);
        return TERMINAL.has(ride.status) ? rest : [ride as unknown as LiveRide, ...rest];
      });
    };
    socket.on('ride:update', upsert);
    socket.on('ride:requested', upsert);
    return () => {
      socket.off('ride:update', upsert);
      socket.off('ride:requested', upsert);
    };
  }, []);

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Live rides</h2>
        {rides && (
          <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[12px] font-semibold text-primary-dark">
            {rides.length} active
          </span>
        )}
      </div>

      {!rides ? (
        <div className="grid place-items-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : rides.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-slate2">Nothing in flight right now.</p>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-slate2">
                <th className="px-2 pb-2 font-semibold">Route</th>
                <th className="px-2 pb-2 font-semibold">Passenger</th>
                <th className="px-2 pb-2 font-semibold">Driver</th>
                <th className="px-2 pb-2 font-semibold">Status</th>
                <th className="px-2 pb-2 text-right font-semibold">Fare</th>
                <th className="px-2 pb-2 text-right font-semibold">Age</th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence initial={false}>
                {rides.map((r) => (
                  <motion.tr
                    key={r.id}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="border-t border-line"
                  >
                    <td className="max-w-[220px] truncate px-2 py-2.5 font-medium">
                      {r.pickupLabel} <ArrowRight className="inline h-3 w-3 text-slate2" /> {r.dropLabel}
                    </td>
                    <td className="px-2 py-2.5">{r.passenger?.fullName ?? '—'}</td>
                    <td className="px-2 py-2.5">
                      {r.driver ? (
                        <>
                          {r.driver.user.fullName} <span className="font-mono text-[11px] text-slate2">{r.driver.vehiclePlate}</span>
                        </>
                      ) : (
                        <span className="text-slate2">unassigned</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono">₹{r.estimatedFare}</td>
                    <td className="px-2 py-2.5 text-right text-slate2">{timeAgo(r.requestedAt)}</td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Verification queue ------------------------------------------------------------------
function VerificationQueue({ onChanged }: { onChanged: () => void }) {
  const [queue, setQueue] = useState<PendingDriver[] | null>(null);

  useEffect(() => {
    void api
      .get<{ drivers: PendingDriver[] }>('/admin/drivers', { params: { verification: 'PENDING' } })
      .then(({ data }) => setQueue(data.drivers))
      .catch(() => setQueue([]));
  }, []);

  const remove = (id: string) => {
    setQueue((q) => (q ? q.filter((d) => d.id !== id) : q));
    onChanged();
  };

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-bold">Driver verification</h2>
      {!queue ? (
        <div className="card grid place-items-center py-10">
          <Spinner className="h-5 w-5" />
        </div>
      ) : queue.length === 0 ? (
        <Empty title="Queue is clear" hint="New driver sign-ups will appear here for approval." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <AnimatePresence initial={false}>
            {queue.map((d) => (
              <VerificationCard key={d.id} driver={d} onDone={() => remove(d.id)} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function VerificationCard({ driver, onDone }: { driver: PendingDriver; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (status: 'APPROVED' | 'REJECTED') => {
    setBusy(status);
    setError(null);
    try {
      await api.post(`/admin/drivers/${driver.id}/verification`, { status, note: note || undefined });
      onDone();
    } catch (e) {
      setError(errorMessage(e, 'Could not update'));
      setBusy(null);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="card space-y-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold">{driver.user.fullName}</p>
          <p className="truncate text-[12px] text-slate2">
            {driver.user.email}
            {driver.user.phone ? ` · ${driver.user.phone}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-soft px-2 py-0.5 text-[11px] font-bold text-[#6a5200]">PENDING</span>
      </div>

      <p className="text-[13px] text-slate2">
        {driver.vehicleType.replace('_', '-')} · {driver.vehicleModel} ·{' '}
        <span className="font-mono">{driver.vehiclePlate}</span> · seats {driver.capacity}
        <br />
        License <span className="font-mono">{driver.licenseNumber}</span>
      </p>

      <div className="flex flex-wrap gap-1.5">
        {driver.documents.length === 0 ? (
          <span className="text-[12px] italic text-slate2">No documents uploaded yet</span>
        ) : (
          driver.documents.map((doc) => (
            <a
              key={doc.id}
              href={docHref(doc.fileUrl)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-primary-dark hover:bg-primary-soft"
            >
              <FileText className="h-3 w-3" /> {doc.type.replace('_', ' ')}
            </a>
          ))
        )}
      </div>

      <input
        className="input"
        placeholder="Note to driver (optional, shown on rejection)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={300}
      />

      {error && <p className="text-[12px] font-medium text-danger">{error}</p>}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={() => decide('APPROVED')} disabled={busy !== null}>
          {busy === 'APPROVED' ? <Spinner /> : (<><BadgeCheck className="h-4 w-4" /> Approve</>)}
        </button>
        <button className="btn-danger flex-1" onClick={() => decide('REJECTED')} disabled={busy !== null}>
          {busy === 'REJECTED' ? <Spinner /> : (<><XCircle className="h-4 w-4" /> Reject</>)}
        </button>
      </div>
    </motion.div>
  );
}

// ---- Demand analytics ------------------------------------------------------------------
const WINDOWS = [7, 14, 30];

function DemandPanel() {
  const [days, setDays] = useState(14);
  const [report, setReport] = useState<DemandReport | null>(null);

  useEffect(() => {
    setReport(null);
    void api
      .get<DemandReport>('/admin/analytics/demand', { params: { days } })
      .then(({ data }) => setReport(data))
      .catch(() => {});
  }, [days]);

  const maxHotspot = useMemo(() => Math.max(1, ...(report?.hotspots.map((h) => h.rides) ?? [1])), [report]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold">Demand patterns</h2>
        <div className="inline-flex gap-1 rounded-lg border border-line bg-white p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`rounded-md px-3 py-1 text-[12px] font-semibold transition ${
                days === w ? 'bg-primary text-white' : 'text-slate2 hover:bg-paper'
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {!report ? (
        <div className="card grid place-items-center py-16">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <>
          <div className="card p-5">
            <p className="font-display text-[15px] font-bold">Rides by hour of day</p>
            <p className="mb-3 text-[12px] text-slate2">
              Peak at <b className="text-ink">{fmtHour(report.peakHour.hour)}</b> with {report.peakHour.rides} rides in the
              last {report.windowDays} days — schedule shuttles and driver shifts around it.
            </p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.byHour} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="#E2E1DA" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickFormatter={(h: number) => (h % 3 === 0 ? String(h) : '')}
                    tick={{ fontSize: 11, fill: '#5A6B61' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    formatter={(v: number) => [v, 'Rides']}
                    labelFormatter={(h: number) => fmtHour(h)}
                    contentStyle={{ borderRadius: 10, border: '1px solid #E2E1DA', fontSize: 12 }}
                  />
                  <Bar dataKey="rides" radius={[3, 3, 0, 0]} maxBarSize={18}>
                    {report.byHour.map((h) => (
                      <Cell key={h.hour} fill={h.hour === report.peakHour.hour ? '#F2B807' : '#0E7A4E'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <p className="mb-3 font-display text-[15px] font-bold">Rides by weekday</p>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.byWeekday} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="#E2E1DA" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip formatter={(v: number) => [v, 'Rides']} contentStyle={{ borderRadius: 10, border: '1px solid #E2E1DA', fontSize: 12 }} />
                    <Bar dataKey="rides" fill="#0E7A4E" radius={[3, 3, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card p-5">
              <p className="mb-3 font-display text-[15px] font-bold">Pickup hotspots</p>
              <div className="space-y-2">
                {report.hotspots.map((h, i) => (
                  <div key={h.zone} className="flex items-center gap-2 text-[12px]">
                    <span className="w-4 font-mono text-slate2">{i + 1}</span>
                    <span className="w-32 truncate font-medium">{h.zone}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-paper">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(h.rides / maxHotspot) * 100}%` }} />
                    </div>
                    <span className="w-9 text-right font-mono text-slate2">{h.rides}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Forecast ---------------------------------------------------------------------------
function ForecastPanel() {
  const [slots, setSlots] = useState<ForecastSlot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ forecast: ForecastSlot[] }>('/admin/analytics/forecast', { params: { hours: 12 } });
      setSlots(data.forecast);
    } catch {
      setSlots([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const recompute = async () => {
    setBusy(true);
    setNote(null);
    try {
      const { data } = await api.post<{ ok: boolean; rows: number }>('/admin/analytics/forecast/recompute');
      setNote(`Recomputed — ${data.rows} zone-hour predictions written.`);
      await load();
    } catch (e) {
      setNote(errorMessage(e, 'Recompute failed'));
    } finally {
      setBusy(false);
    }
  };

  const chartData = useMemo(
    () =>
      (slots ?? []).map((s) => ({
        ...s,
        label: new Date(s.forHour).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
      })),
    [slots],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold">Next 12 hours</h2>
          <p className="text-[12px] text-slate2">
            Seasonal-naive forecast by zone, hour-of-day and weekday — refreshed hourly by a background worker.
          </p>
        </div>
        <button className="btn-ghost" onClick={recompute} disabled={busy}>
          {busy ? <Spinner /> : (<><RefreshCcw className="h-4 w-4" /> Recompute now</>)}
        </button>
      </div>

      {note && <p className="rounded-lg bg-primary-soft px-3 py-2 text-[13px] font-medium text-primary-dark">{note}</p>}

      {!slots ? (
        <div className="card grid place-items-center py-16">
          <Spinner className="h-5 w-5" />
        </div>
      ) : slots.length === 0 ? (
        <Empty title="No forecast yet" hint="Hit “Recompute now” to generate predictions from ride history." />
      ) : (
        <>
          <div className="card p-5">
            <p className="mb-3 font-display text-[15px] font-bold">Predicted rides per hour (all zones)</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke="#E2E1DA" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#5A6B61' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [v, 'Predicted rides']} contentStyle={{ borderRadius: 10, border: '1px solid #E2E1DA', fontSize: 12 }} />
                  <Bar dataKey="total" fill="#0E7A4E" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card p-5">
            <p className="mb-3 font-display text-[15px] font-bold">Where to position drivers</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {chartData.slice(0, 6).map((s) => (
                <div key={s.forHour} className="flex items-baseline justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span className="font-mono text-[12px] font-semibold text-slate2">{s.label}</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {s.topZones.map((z) => (
                      <span key={z.zone} className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-semibold text-primary-dark">
                        {z.zone} · {z.rides}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
