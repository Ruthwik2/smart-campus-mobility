# Smart Campus Mobility Platform

A real-time ride dispatch platform for a university campus — passengers book e-rickshaw, auto, and shuttle rides between campus zones; verified drivers accept jobs from a live board and run trips with OTP-verified starts; an operations team watches the whole fleet, approves drivers, and plans around demand forecasts. Built for the IIT Roorkee *Real-Time Campus Mobility and Ride Management Platform* brief.

## What it does

**Passengers** pick pickup and drop from 48 seeded campus zones (gates, bhawans, and every IIT Roorkee department), see the flat ₹10 fare and how many drivers are nearby, and either request now or schedule for later. Once a driver accepts, the screen shows who is coming — vehicle, plate, rating, a call button — plus a live distance-to-pickup that ticks down as the driver moves, and the 4-digit code the driver must enter to start the trip. Completed rides settle (simulated UPI/cash) and prompt a star rating.

**Drivers** sign up with vehicle and license details, upload verification documents, and once approved flip a single switch to go online. New requests animate onto a dispatch board in real time; accepting is race-safe (the loser of a simultaneous tap gets a clean "another driver picked that up" instead of a double booking). The active job walks through OTP start → complete, a bail option returns the ride to the board, and a performance tab charts 14 days of rides and earnings with a rating breakdown.

**Admins** get an operations console: live KPI tiles (active rides, drivers online, completion rate, average pickup wait), a self-updating table of every ride in flight, and the driver verification queue with document previews and approve/reject. Analytics tabs show demand by hour and weekday with pickup hotspots, plus a per-zone, per-hour forecast for the next 24 hours (seasonal-naive with recency weighting, recomputed hourly) that answers "where should drivers wait at 5 pm?".

Under the hood: a 7-state ride machine enforced by guarded conditional writes, an in-process domain event bus feeding Socket.IO rooms, Redis GEO for nearby-driver lookups, BullMQ for request expiry / scheduled-ride promotion / hourly forecasting, and JWT auth with rotating hashed refresh tokens. The full story is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Stack

| Layer | Choices |
|---|---|
| API | Node 20 · Express · TypeScript · Prisma 6 (PostgreSQL 15) · Socket.IO · BullMQ · Zod · Redis 7 |
| Web | Next.js 14 (App Router) · Tailwind CSS · Radix UI · Zustand · React Hook Form + Zod · Recharts · Framer Motion · socket.io-client |
| Infra | Docker Compose · nginx edge (single origin, WS upgrade) · GitHub Actions CI |

## Run it

```bash
docker compose up -d --build     # first build takes a few minutes
# then open
http://localhost:8080
```

That's the whole setup: Postgres and Redis come up with healthchecks, the API syncs the schema and seeds demo data (idempotent), and nginx serves everything on one origin. Manual/dev setup without Docker is in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Demo accounts

All passwords are `Password123!`.

| Role | Email | Notes |
|---|---|---|
| Admin | `admin@campus.test` | operations console |
| Drivers | `driver1@campus.test` … `driver6@campus.test` | approved, ready to go online |
| Passengers | `ananya@campus.test`, `rohit@campus.test`, `priya@campus.test`, `kabir@campus.test` | ~30 days of ride history seeded |

## Ninety-second walkthrough

Open two browser windows side by side (one normal, one incognito). Log in as `ananya@campus.test` in one and `driver1@campus.test` in the other. As the driver, flip the availability switch — the dot starts pulsing. As Ananya, pick *Rajendra Bhawan → Main Building*, watch the fare estimate update, and hit **Request ride now**. The request card slides onto the driver's board instantly; accept it. Ananya's screen flips to "on the way" with the driver's details and a live distance that shrinks every few seconds (no GPS permission? a campus simulator drives the marker). Read the 4-digit code off Ananya's screen, type it on the driver side, **Start trip**, then **Complete ride** — Ananya gets the rating dialog, the driver's earnings tick up. Now log in as `admin@campus.test` in a third tab: the ride you just ran is in the live table, today's KPIs moved, and the *Demand*/*Forecast* tabs are already populated from the seeded month of history. For the race-condition party trick, put two driver windows on the same request and tap **Accept** simultaneously.

## Project structure

```
├── server/                 # Express + TypeScript API
│   ├── prisma/             #   schema + idempotent demo seed
│   ├── src/
│   │   ├── modules/        #   auth · rides · drivers · ratings · zones · users · admin
│   │   ├── sockets/        #   rooms, presence grace, location fan-out
│   │   ├── queues/         #   BullMQ: expiry · scheduled rides · forecasts
│   │   ├── lib/            #   prisma · redis · event bus · storage · logger
│   │   └── middleware/     #   auth guards · zod validate · error envelope
│   └── tests/              #   ride state-machine unit tests (vitest)
├── web/                    # Next.js 14 app
│   └── src/
│       ├── app/            #   landing · login · register · passenger · driver · admin
│       ├── components/     #   AppShell · ride widgets · UI kit
│       ├── stores/         #   zustand: auth (token+refresh) · live (socket state)
│       └── lib/            #   axios w/ single-flight refresh · socket · API types
├── nginx/                  # single-origin edge config
├── docs/                   # ARCHITECTURE · API · SOCKETS · SECURITY · DEPLOYMENT
└── docker-compose.yml      # postgres · redis · api · web · nginx
```

## Documentation

| Doc | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | system diagrams, ER model, state machine, the accept race, event bus, forecasting rationale |
| [`docs/API.md`](docs/API.md) | every endpoint, envelope, and error code |
| [`docs/SOCKETS.md`](docs/SOCKETS.md) | rooms, events, payloads, disconnect grace |
| [`docs/SECURITY.md`](docs/SECURITY.md) | token model, refresh rotation, OTP, validation, limits |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | compose, env reference, migrations, scaling |

## Quality

Both apps typecheck clean (`npm run typecheck` in `server/` and `web/`), the ride state machine has unit tests (`npm test` in `server/`, 8 passing), and CI runs typecheck → test → build for both apps plus Docker image builds on every push.

**Honest verification note:** this codebase was authored in a sandbox where npm registry access allowed full dependency installation, typechecking, and unit testing — but Prisma's engine binaries and Google Fonts are unreachable there, so the following were *not* executed end-to-end before delivery: the server runtime against live Postgres/Redis, `next build`, and the Docker image builds. Those paths are exercised by the compose flow and CI on any normally connected machine; if anything trips on first run, it will be in that runtime seam rather than in type-level correctness.
