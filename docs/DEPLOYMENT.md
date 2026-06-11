# Deployment

## The three-command path

```bash
git clone <repo> && cd smart-campus-mobility
docker compose up -d --build
open http://localhost:8080
```

Compose brings up Postgres 15 and Redis 7 (with healthchecks), builds the API and web images, and fronts both with nginx on **:8080**. On first boot the API container runs `prisma db push` (schema sync), then the idempotent seed (12 IIT Roorkee zones, 1 admin, 6 approved drivers, 4 passengers, ~600 historical rides for the analytics), then starts the server. Subsequent boots detect existing data and skip re-seeding. First build takes a few minutes (npm installs + Next build); after that, `make up` / `make down` / `make logs` cover the daily loop.

## Topology and ports

| Port | Service | Purpose |
|---|---|---|
| 8080 | nginx | the app — Next.js on `/`, API on `/api`, websockets on `/socket.io`, documents on `/uploads` |
| 4000 | api (direct) | curl/Postman convenience; not needed by the browser |
| 5432 / 6379 | postgres / redis | internal; exposed only on the compose network |

The web image inlines `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_SOCKET_URL` at **build time** (compose passes `http://localhost:8080`). Deploying under a different host/port means rebuilding the web image with new args — that is a Next.js property, not a quirk of this repo.

## Manual development setup

```bash
docker compose up -d postgres redis          # just the data stores
cp .env.example server/.env
cd server && npm install && npx prisma migrate dev && npm run seed && npm run dev
# new terminal
cd web && npm install && npm run dev          # http://localhost:3000, talks to :4000
```

For the web app to point at the local API, create `web/.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4000` (the default when unset, so this is optional).

## Environment reference

All server configuration is validated at boot by a Zod schema (`src/config/env.ts`) — a missing or malformed variable fails fast with a readable message. The full annotated list lives in `.env.example`; the load-bearing ones are `DATABASE_URL`, `REDIS_URL`, the two JWT secrets (min 16 chars — generate real ones for anything shared), `CORS_ORIGINS` (comma-separated allow-list), and the dispatch knobs `RIDE_DISPATCH_TIMEOUT_SEC` / `SCHEDULED_DISPATCH_LEAD_MIN`. Setting the five `S3_*` variables switches driver-document storage from local disk to any S3-compatible bucket with no code change.

## `db push` vs `migrate deploy`

The shipped container runs `prisma db push` at boot because a hackathon evaluation should never stall on migration state. For a real deployment, switch to committed migrations: run `npx prisma migrate dev --name init` once locally (creates `prisma/migrations/`), commit it, and change the Dockerfile `CMD` to

```
npx prisma migrate deploy && node dist/index.js
```

moving the seed to an explicit one-time `docker compose exec api npx prisma db seed`. From that point schema history is reviewable, reversible, and safe against drift — `db push` should never touch a database whose data you care about.

## Scaling notes

The single API process is deliberately splittable. Socket.IO already runs on the **Redis adapter**, so adding `api` replicas behind nginx (`least_conn` upstream) preserves event delivery across instances; enable sticky sessions only if you later allow HTTP long-polling fallback (the client pins `transports: ['websocket']`, which needs none). BullMQ workers can move to a dedicated process by importing `initQueues` from a separate entrypoint — producers and workers only meet in Redis. Postgres is the system of record and the first real bottleneck; the heavy read paths (dashboards, analytics) are aggregate queries that take read replicas naturally. Driver GPS write volume lands on Redis GEO by design, with Postgres persistence throttled, so location fan-in scales independently of the relational store.

## Operational odds and ends

Graceful shutdown is wired: SIGTERM drains the HTTP server, closes queues, and disconnects Prisma/Redis, so `docker compose down` and rolling restarts are clean. Logs are pino JSON on stdout — point your collector at container output. The `uploads` named volume holds driver documents in disk mode; in S3 mode it can be dropped. A `GET /api/v1/health` endpoint returns `{ ok: true }` for load-balancer checks.
