import { prisma } from '../../lib/prisma';
import { GEO_DRIVERS_KEY, redis } from '../../lib/redis';

// ─────────────────────────── Ops overview ───────────────────────────

export async function overview() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [byStatusToday, activeRides, onlineDrivers, pendingDrivers, waitAgg, totalUsers] = await Promise.all([
    prisma.ride.groupBy({ by: ['status'], where: { createdAt: { gte: startOfToday } }, _count: true }),
    prisma.ride.count({ where: { status: { in: ['REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] } } }),
    redis.zcard(GEO_DRIVERS_KEY).catch(() => 0),
    prisma.driverProfile.count({ where: { verificationStatus: 'PENDING' } }),
    // Mean pickup wait = accept time − request time over the last 7 days.
    prisma.$queryRaw<{ avg_wait_sec: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("acceptedAt" - "requestedAt"))) AS avg_wait_sec
      FROM rides
      WHERE "acceptedAt" IS NOT NULL
        AND "requestedAt" >= NOW() - INTERVAL '7 days'`,
    prisma.user.count(),
  ]);

  const todayCounts = Object.fromEntries(byStatusToday.map((r) => [r.status, r._count]));
  const completed = todayCounts.COMPLETED ?? 0;
  const totalToday = byStatusToday.reduce((s, r) => s + r._count, 0);

  return {
    todayCounts,
    totalToday,
    completionRateToday: totalToday ? Number(((completed / totalToday) * 100).toFixed(1)) : 0,
    activeRides,
    onlineDrivers: Number(onlineDrivers),
    pendingDrivers,
    avgWaitSec: Math.round(Number(waitAgg[0]?.avg_wait_sec ?? 0)),
    totalUsers,
  };
}

export async function liveRides() {
  return prisma.ride.findMany({
    where: { status: { in: ['SCHEDULED', 'REQUESTED', 'ACCEPTED', 'IN_PROGRESS'] } },
    orderBy: { requestedAt: 'desc' },
    take: 50,
    include: {
      passenger: { select: { fullName: true } },
      driver: { select: { vehiclePlate: true, user: { select: { fullName: true } } } },
    },
  });
}

// ─────────────────────────── Demand analytics ───────────────────────────

/** Rides per hour-of-day and per weekday, plus pickup hotspots (last N days). */
export async function demandAnalytics(days = 14) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [byHour, byWeekday, hotspots] = await Promise.all([
    prisma.$queryRaw<{ hour: number; rides: bigint }[]>`
      SELECT EXTRACT(HOUR FROM "requestedAt")::int AS hour, COUNT(*) AS rides
      FROM rides WHERE "requestedAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ dow: number; rides: bigint }[]>`
      SELECT EXTRACT(DOW FROM "requestedAt")::int AS dow, COUNT(*) AS rides
      FROM rides WHERE "requestedAt" >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.ride.groupBy({
      by: ['pickupLabel'],
      where: { requestedAt: { gte: since } },
      _count: true,
      orderBy: { _count: { pickupLabel: 'desc' } },
      take: 8,
    }),
  ]);

  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    rides: Number(byHour.find((r) => r.hour === h)?.rides ?? 0),
  }));
  const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekdays = weekdayNames.map((name, i) => ({
    day: name,
    rides: Number(byWeekday.find((r) => r.dow === i)?.rides ?? 0),
  }));

  return {
    windowDays: days,
    byHour: hours,
    byWeekday: weekdays,
    hotspots: hotspots.map((h) => ({ zone: h.pickupLabel, rides: h._count })),
    peakHour: hours.reduce((best, h) => (h.rides > best.rides ? h : best), hours[0]),
  };
}

// ─────────────────────────── Demand forecasting ───────────────────────────

/**
 * Seasonal-naive forecaster with exponential recency weighting.
 *
 * Demand on a campus is dominated by two seasonalities — hour-of-day and
 * day-of-week (8 am lecture rush ≠ Sunday 8 am). For each (zone, hourOfDay,
 * dayOfWeek) bucket we take a weighted mean of the last 4 matching weeks,
 * weighting recent weeks more (w = 0.5^age). It is transparent, trains in a
 * single SQL pass, and beats black-box models at this data volume. The
 * modelVersion column leaves room to swap in gradient boosting later
 * without a schema change.
 */
export async function recomputeForecasts(horizonHours = 24) {
  const since = new Date(Date.now() - 28 * 24 * 3600 * 1000);

  const history = await prisma.$queryRaw<
    { zone: string; dow: number; hour: number; day: Date; rides: bigint }[]
  >`
    SELECT "pickupLabel" AS zone,
           EXTRACT(DOW FROM "requestedAt")::int AS dow,
           EXTRACT(HOUR FROM "requestedAt")::int AS hour,
           date_trunc('day', "requestedAt") AS day,
           COUNT(*) AS rides
    FROM rides
    WHERE "requestedAt" >= ${since}
    GROUP BY 1, 2, 3, 4`;

  // bucket key → [{ageWeeks, rides}]
  const buckets = new Map<string, { age: number; rides: number }[]>();
  const now = Date.now();
  for (const row of history) {
    const key = `${row.zone}|${row.dow}|${row.hour}`;
    const ageWeeks = Math.floor((now - row.day.getTime()) / (7 * 24 * 3600 * 1000));
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push({ age: ageWeeks, rides: Number(row.rides) });
  }

  const predict = (zone: string, dow: number, hour: number) => {
    const samples = buckets.get(`${zone}|${dow}|${hour}`);
    if (!samples?.length) return 0;
    let num = 0;
    let den = 0;
    for (const s of samples) {
      const w = Math.pow(0.5, s.age);
      num += s.rides * w;
      den += w;
    }
    return den ? num / den : 0;
  };

  const zones = await prisma.campusZone.findMany({ select: { name: true } });
  const start = new Date();
  start.setMinutes(0, 0, 0);

  const rows = [];
  for (let h = 1; h <= horizonHours; h++) {
    const forHour = new Date(start.getTime() + h * 3600 * 1000);
    for (const z of zones) {
      const predicted = predict(z.name, forHour.getDay(), forHour.getHours());
      if (predicted > 0.05) {
        rows.push({ zoneName: z.name, forHour, predictedRides: Number(predicted.toFixed(2)) });
      }
    }
  }

  // Idempotent refresh of the horizon window.
  await prisma.$transaction([
    prisma.demandForecast.deleteMany({ where: { forHour: { gte: start } } }),
    prisma.demandForecast.createMany({ data: rows, skipDuplicates: true }),
  ]);
  return rows.length;
}

/** Forecast for the next `hours`, aggregated per hour with top zones, vs recent actuals. */
export async function forecastReport(hours = 12) {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + hours * 3600 * 1000);

  const rows = await prisma.demandForecast.findMany({
    where: { forHour: { gte: start, lte: end } },
    orderBy: { forHour: 'asc' },
  });

  const perHour = new Map<string, { forHour: string; total: number; topZones: { zone: string; rides: number }[] }>();
  for (const r of rows) {
    const key = r.forHour.toISOString();
    const slot = perHour.get(key) ?? { forHour: key, total: 0, topZones: [] };
    slot.total += r.predictedRides;
    slot.topZones.push({ zone: r.zoneName, rides: r.predictedRides });
    perHour.set(key, slot);
  }

  return Array.from(perHour.values()).map((s) => ({
    ...s,
    total: Number(s.total.toFixed(1)),
    topZones: s.topZones.sort((a, b) => b.rides - a.rides).slice(0, 3),
  }));
}

// ─────────────────────────── Driver verification ───────────────────────────

export async function setVerification(driverProfileId: string, status: 'APPROVED' | 'REJECTED', note?: string) {
  return prisma.driverProfile.update({
    where: { id: driverProfileId },
    data: {
      verificationStatus: status,
      verificationNote: note,
      ...(status === 'REJECTED' ? { status: 'OFFLINE' } : {}),
    },
    include: { user: { select: { fullName: true, email: true } }, documents: true },
  });
}
