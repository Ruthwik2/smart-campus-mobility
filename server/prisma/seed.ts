/* eslint-disable no-console */
import { PrismaClient, Prisma, RideStatus, PaymentMethod, PaymentStatus, VehicleType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

/** Well-known landmarks across the IIT Roorkee campus (approximate coordinates). */
const CAMPUS_ZONES = [
  // Gates & central landmarks
  { name: 'Main Gate', lat: 29.8665, lng: 77.8924 },
  { name: 'Century Gate', lat: 29.8604, lng: 77.8988 },
  { name: 'Main Building', lat: 29.8649, lng: 77.8965 },
  { name: 'Central Library', lat: 29.8655, lng: 77.8951 },
  { name: 'Convocation Hall (Saraswati Mandir)', lat: 29.866, lng: 77.8959 },
  { name: 'LHC Complex', lat: 29.8641, lng: 77.8979 },
  { name: 'Hospital', lat: 29.8687, lng: 77.8911 },
  { name: 'Sports Complex', lat: 29.8612, lng: 77.8942 },
  { name: 'Student Centre', lat: 29.8657, lng: 77.8938 },
  { name: 'MAC (Multi Activity Centre)', lat: 29.8619, lng: 77.8955 },
  { name: 'LBS', lat: 29.8607, lng: 77.8965 },
  { name: 'ABN', lat: 29.8636, lng: 77.8946 },
  { name: 'PIC', lat: 29.8645, lng: 77.8935 },
  // Bhawans & residences
  { name: 'Rajendra Bhawan', lat: 29.8693, lng: 77.8989 },
  { name: 'Govind Bhawan', lat: 29.8701, lng: 77.895 },
  { name: 'Sarojini Bhawan', lat: 29.8678, lng: 77.8932 },
  { name: 'Cautley Bhawan', lat: 29.8625, lng: 77.9001 },
  { name: 'Ganga Bhawan', lat: 29.8708, lng: 77.8978 },
  { name: 'Kasturba Bhawan', lat: 29.8682, lng: 77.8941 },
  { name: 'Himalaya Bhawan', lat: 29.8712, lng: 77.8935 },
  { name: 'Jawahar Bhawan', lat: 29.8719, lng: 77.8959 },
  { name: 'Rajiv Bhawan', lat: 29.8722, lng: 77.8985 },
  { name: 'Ravindra Bhawan', lat: 29.8669, lng: 77.8975 },
  { name: 'Radhakrishnan Bhawan', lat: 29.8698, lng: 77.9006 },
  { name: 'Azad Bhawan', lat: 29.8632, lng: 77.893 },
  { name: 'Indira Bhawan', lat: 29.8716, lng: 77.8917 },
  { name: 'Vigyan Kunj', lat: 29.8727, lng: 77.8946 },
  { name: 'Khosla International House', lat: 29.8661, lng: 77.899 },
  // Departments (Roorkee campus)
  { name: 'Architecture & Planning Department', lat: 29.8647, lng: 77.8989 },
  { name: 'Biosciences & Bioengineering Department', lat: 29.8651, lng: 77.8997 },
  { name: 'Chemical Engineering Department', lat: 29.8639, lng: 77.8992 },
  { name: 'Chemistry Department', lat: 29.8644, lng: 77.8973 },
  { name: 'Civil Engineering Department', lat: 29.8652, lng: 77.8972 },
  { name: 'Computer Science & Engineering Department', lat: 29.8674, lng: 77.8962 },
  { name: 'Design Department', lat: 29.8628, lng: 77.8975 },
  { name: 'Earth Sciences Department', lat: 29.8631, lng: 77.8963 },
  { name: 'Earthquake Engineering Department', lat: 29.8668, lng: 77.8999 },
  { name: 'Electrical Engineering Department', lat: 29.8653, lng: 77.8962 },
  { name: 'Electronics & Communication Engineering Department', lat: 29.8659, lng: 77.8969 },
  { name: 'Humanities & Social Sciences Department', lat: 29.8648, lng: 77.895 },
  { name: 'Hydrology Department', lat: 29.8637, lng: 77.9006 },
  { name: 'Hydro & Renewable Energy Department', lat: 29.8682, lng: 77.9008 },
  { name: 'Management Studies Department', lat: 29.8615, lng: 77.8978 },
  { name: 'Mathematics Department', lat: 29.865, lng: 77.8957 },
  { name: 'Mechanical & Industrial Engineering Department', lat: 29.8642, lng: 77.8954 },
  { name: 'Metallurgical & Materials Engineering Department', lat: 29.8634, lng: 77.8983 },
  { name: 'Physics Department', lat: 29.8646, lng: 77.8943 },
  { name: 'Water Resources Development & Management Department', lat: 29.8676, lng: 77.899 },
];

const DRIVERS = [
  { fullName: 'Ramesh Kumar', phone: '+91-9810000001', vehicleType: VehicleType.E_RICKSHAW, plate: 'UK17ER1101' },
  { fullName: 'Sita Devi', phone: '+91-9810000002', vehicleType: VehicleType.E_RICKSHAW, plate: 'UK17ER1102' },
  { fullName: 'Arif Khan', phone: '+91-9810000003', vehicleType: VehicleType.E_RICKSHAW, plate: 'UK17ER1103' },
  { fullName: 'Bhola Singh', phone: '+91-9810000004', vehicleType: VehicleType.AUTO, plate: 'UK17AT2201' },
  { fullName: 'Meena Rawat', phone: '+91-9810000005', vehicleType: VehicleType.E_RICKSHAW, plate: 'UK17ER1104' },
  { fullName: 'Devraj Negi', phone: '+91-9810000006', vehicleType: VehicleType.SHUTTLE, plate: 'UK17SH3301' },
];

const PASSENGERS = [
  { fullName: 'Ananya Sharma', email: 'ananya@campus.test' },
  { fullName: 'Rohit Verma', email: 'rohit@campus.test' },
  { fullName: 'Priya Nair', email: 'priya@campus.test' },
  { fullName: 'Kabir Mehta', email: 'kabir@campus.test' },
];

const PASSWORD = 'Password123!';

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Flat campus tariff: ₹10 between any two zones.
const estimateFare = (_km: number) => 10;
const rideCode = () => `R-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const otp = () => String(crypto.randomInt(1000, 10000));

/** Weighted hour-of-day picker: strong 8–10 morning and 17–19 evening peaks. */
function pickHour(rng: () => number) {
  const weights = [1, 1, 0.5, 0.5, 0.5, 1, 2, 4, 9, 10, 6, 4, 4, 4, 4, 5, 6, 9, 10, 7, 5, 4, 3, 2];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let h = 0; h < 24; h++) {
    r -= weights[h];
    if (r <= 0) return h;
  }
  return 12;
}

/** Deterministic PRNG so reseeding produces the same demo data. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  console.log('Seeding Smart Campus Mobility…');
  const rng = mulberry32(20260610);
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ---- Zones ----------------------------------------------------------------
  // Drop zones that are no longer part of the campus list (e.g. renamed/removed stops).
  await prisma.campusZone.deleteMany({ where: { name: { notIn: CAMPUS_ZONES.map((z) => z.name) } } });
  for (const z of CAMPUS_ZONES) {
    await prisma.campusZone.upsert({ where: { name: z.name }, update: { lat: z.lat, lng: z.lng }, create: z });
  }

  // ---- Admin ----------------------------------------------------------------
  await prisma.user.upsert({
    where: { email: 'admin@campus.test' },
    update: {},
    create: { email: 'admin@campus.test', fullName: 'Transport Office', role: 'ADMIN', passwordHash },
  });

  // ---- Drivers (approved, ready to go online) ---------------------------------
  const driverProfiles: { id: string; userId: string }[] = [];
  for (let i = 0; i < DRIVERS.length; i++) {
    const d = DRIVERS[i];
    const email = `driver${i + 1}@campus.test`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        fullName: d.fullName,
        phone: d.phone,
        role: 'DRIVER',
        passwordHash,
        driverProfile: {
          create: {
            vehicleType: d.vehicleType,
            vehiclePlate: d.plate,
            vehicleModel:
              d.vehicleType === VehicleType.E_RICKSHAW
                ? 'Mahindra Treo'
                : d.vehicleType === VehicleType.AUTO
                  ? 'Bajaj RE'
                  : 'Tata Winger',
            capacity: d.vehicleType === VehicleType.SHUTTLE ? 10 : 3,
            licenseNumber: `UK-${100000 + i}`,
            verificationStatus: 'APPROVED',
            status: 'OFFLINE',
          },
        },
      },
      include: { driverProfile: true },
    });
    if (user.driverProfile) driverProfiles.push({ id: user.driverProfile.id, userId: user.id });
  }

  // ---- Passengers --------------------------------------------------------------
  const passengerUsers: { id: string }[] = [];
  for (const p of PASSENGERS) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: { email: p.email, fullName: p.fullName, role: 'PASSENGER', passwordHash },
    });
    passengerUsers.push(user);
  }

  // ---- Historical rides (30 days) for analytics + forecasting --------------------
  const existing = await prisma.ride.count();
  if (existing > 0) {
    console.log(`Rides already present (${existing}) — skipping history generation.`);
  } else {
    const now = new Date();
    const rides: Prisma.RideCreateManyInput[] = [];

    for (let day = 30; day >= 1; day--) {
      const weekday = new Date(now.getTime() - day * 86_400_000).getDay();
      const dailyBase = weekday === 0 || weekday === 6 ? 12 : 22; // quieter weekends
      const count = dailyBase + Math.floor(rng() * 8);

      for (let i = 0; i < count; i++) {
        const from = CAMPUS_ZONES[Math.floor(rng() * CAMPUS_ZONES.length)];
        let to = CAMPUS_ZONES[Math.floor(rng() * CAMPUS_ZONES.length)];
        while (to.name === from.name) to = CAMPUS_ZONES[Math.floor(rng() * CAMPUS_ZONES.length)];

        const hour = pickHour(rng);
        const requestedAt = new Date(now.getTime() - day * 86_400_000);
        requestedAt.setHours(hour, Math.floor(rng() * 60), Math.floor(rng() * 60), 0);

        const km = Math.max(0.4, haversineKm(from.lat, from.lng, to.lat, to.lng));
        const fare = estimateFare(km);
        const profile = driverProfiles[Math.floor(rng() * driverProfiles.length)];
        const passenger = passengerUsers[Math.floor(rng() * passengerUsers.length)];

        const cancelled = rng() < 0.07;
        const acceptedAt = new Date(requestedAt.getTime() + (20 + rng() * 100) * 1000);
        const startedAt = new Date(acceptedAt.getTime() + (60 + rng() * 240) * 1000);
        const completedAt = new Date(startedAt.getTime() + (km / 12) * 3_600_000); // ~12 km/h e-rickshaw

        rides.push({
          code: rideCode(),
          passengerId: passenger.id,
          driverId: cancelled ? null : profile.id,
          status: cancelled ? RideStatus.CANCELLED : RideStatus.COMPLETED,
          pickupLabel: from.name,
          pickupLat: from.lat,
          pickupLng: from.lng,
          dropLabel: to.name,
          dropLat: to.lat,
          dropLng: to.lng,
          distanceKm: Number(km.toFixed(2)),
          estimatedFare: fare,
          finalFare: cancelled ? null : fare,
          paymentMethod: rng() < 0.6 ? PaymentMethod.UPI : PaymentMethod.CASH,
          paymentStatus: cancelled ? PaymentStatus.PENDING : PaymentStatus.PAID,
          paymentRef: cancelled ? null : `UPI-${requestedAt.getTime()}`,
          startOtp: otp(),
          requestedAt,
          acceptedAt: cancelled ? null : acceptedAt,
          startedAt: cancelled ? null : startedAt,
          completedAt: cancelled ? null : completedAt,
          cancelledAt: cancelled ? requestedAt : null,
          cancelledBy: cancelled ? 'PASSENGER' : null,
          cancelReason: cancelled ? 'Changed plans' : null,
          createdAt: requestedAt,
        });
      }
    }

    await prisma.ride.createMany({ data: rides });
    console.log(`Inserted ${rides.length} historical rides.`);

    const completed = await prisma.ride.findMany({
      where: { status: RideStatus.COMPLETED },
      select: { id: true, passengerId: true, driverId: true },
    });

    let ratingCount = 0;
    for (const r of completed) {
      if (!r.driverId || rng() > 0.75) continue; // ~75% of rides get rated
      const stars = rng() < 0.65 ? 5 : rng() < 0.7 ? 4 : 3;
      await prisma.rating.create({
        data: {
          rideId: r.id,
          passengerId: r.passengerId,
          driverId: r.driverId,
          stars,
          comment: stars === 5 ? 'Smooth ride!' : stars === 4 ? 'Good, slight wait.' : 'Okay.',
        },
      });
      ratingCount++;
    }
    console.log(`Inserted ${ratingCount} ratings.`);

    // Roll rating + ride aggregates onto driver profiles.
    for (const p of driverProfiles) {
      const [agg, total] = await Promise.all([
        prisma.rating.aggregate({ where: { driverId: p.id }, _avg: { stars: true }, _count: true }),
        prisma.ride.count({ where: { driverId: p.id, status: RideStatus.COMPLETED } }),
      ]);
      await prisma.driverProfile.update({
        where: { id: p.id },
        data: {
          ratingAvg: Number((agg._avg.stars ?? 0).toFixed(2)),
          ratingCount: agg._count,
          totalRides: total,
        },
      });
    }
  }

  console.log('\nSeed complete. Demo logins (password for all: Password123!)');
  console.log('  admin@campus.test                      — transport office console');
  console.log('  driver1..6@campus.test                 — approved drivers');
  console.log('  ananya|rohit|priya|kabir@campus.test   — passengers');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
