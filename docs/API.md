# API Reference

Base URL: `http://localhost:8080/api/v1` (via nginx) or `http://localhost:4000/api/v1` (direct).

Authentication uses a **Bearer access token** (15 min) plus an **httpOnly refresh cookie** (`scm_refresh`, path-scoped to `/api/v1/auth`). Send `Authorization: Bearer <accessToken>` on every protected call; when it expires, `POST /auth/refresh` (with credentials) mints a new pair. All requests and responses are JSON unless noted.

## Conventions

Success responses wrap their payload in a named key (`{ "ride": ... }`, `{ "rides": [...] }`). Errors share one envelope:

```json
{ "error": { "code": "RIDE_TAKEN", "message": "Another driver accepted this ride first" } }
```

| HTTP | Common codes |
|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_TYPE`, `FILE_REQUIRED`, `BAD_OTP` |
| 401 | `UNAUTHENTICATED` (no token), `TOKEN_INVALID` (bad/expired), `BAD_CREDENTIALS`, `REFRESH_MISSING`, `REFRESH_INVALID` |
| 403 | `FORBIDDEN` (wrong role), `NOT_VERIFIED` (driver not approved), `NOT_YOUR_RIDE` |
| 404 | `NOT_FOUND`, `RIDE_NOT_FOUND`, `DRIVER_NOT_FOUND` |
| 409 | `RIDE_TAKEN`, `ILLEGAL_TRANSITION`, `RIDE_ALREADY_ACTIVE`, `ON_RIDE`, `USER_EXISTS`, `ALREADY_RATED` |
| 429 | rate limit exceeded (plain 429, `Retry-After` via standard headers) |

## Auth

| Method & path | Body | Returns |
|---|---|---|
| `POST /auth/register` | `{ fullName, email, phone?, password }` | `201 { user, accessToken }` + refresh cookie |
| `POST /auth/register/driver` | passenger fields + `{ licenseNumber, vehicleType?, vehicleModel, vehiclePlate, capacity? }` | `201 { user, accessToken }` — profile starts `PENDING` |
| `POST /auth/login` | `{ email, password }` | `{ user, accessToken }` + refresh cookie |
| `POST /auth/refresh` | — (cookie) | `{ user, accessToken }` + **rotated** cookie |
| `POST /auth/logout` | — (cookie) | `{ ok: true }`, revokes the refresh token |
| `GET /auth/me` | — | `{ user }` (includes `driverProfile` when present) |

Password rule: ≥ 8 chars with at least one letter and one digit. `vehicleType` ∈ `E_RICKSHAW | AUTO | CAB | SHUTTLE` (default `E_RICKSHAW`).

## Users

| Method & path | Notes |
|---|---|
| `PATCH /users/me` | Update `fullName` / `phone` → `{ user }` |
| `POST /users/me/avatar` | multipart, field `file` → `{ user }` |

## Zones

`GET /zones` → `{ zones: [{ id, name, lat, lng }] }` — the 12 seeded campus locations used for pickup/drop selection.

## Rides

| Method & path | Who | Body / query | Returns |
|---|---|---|---|
| `POST /rides` | passenger | `{ pickupLabel, pickupLat, pickupLng, dropLabel, dropLat, dropLng, paymentMethod?, scheduledFor? }` | `201 { ride }` (`REQUESTED`, or `SCHEDULED` if `scheduledFor`) |
| `GET /rides` | both | `?status=` optional | `{ rides }` — caller's history, newest first |
| `GET /rides/active` | both | — | `{ ride \| null }` — current non-terminal ride |
| `GET /rides/open` | driver | — | `{ rides }` — the live dispatch board (`REQUESTED`) |
| `GET /rides/:id` | participant | — | `{ ride }` |
| `POST /rides/:id/accept` | driver | — | `{ ride }` or `409 RIDE_TAKEN` |
| `POST /rides/:id/start` | assigned driver | `{ otp }` (4 digits) | `{ ride }` (`IN_PROGRESS`) |
| `POST /rides/:id/complete` | assigned driver | — | `{ ride }` (`COMPLETED`, `finalFare` set, simulated payment settles) |
| `POST /rides/:id/cancel` | participant | `{ reason? }` | `{ ride }` — passenger: `SCHEDULED/REQUESTED/ACCEPTED → CANCELLED`; driver: `ACCEPTED → REQUESTED` (back on the board) |

Ride objects always include `passenger { id, fullName, phone, avatarUrl }`, `driver` (the **DriverProfile** with nested `user { fullName, phone, avatarUrl }`, or `null`), `rating`, fare fields, and `startOtp`. Constraint: one non-terminal ride per passenger (`409 RIDE_ALREADY_ACTIVE`).

## Ratings

| Method & path | Notes |
|---|---|
| `POST /rides/:id/rating` | passenger, completed rides only: `{ stars 1–5, comment? }` → `201 { rating }`; one per ride |
| `GET /drivers/:driverId/ratings` | recent ratings for a driver profile → `{ ratings }` |

## Drivers

| Method & path | Who | Notes |
|---|---|---|
| `GET /drivers/nearby?lat&lng&radiusKm=5` | any authed | `{ drivers }` — online, approved, within radius (Redis GEO) |
| `PATCH /drivers/me/availability` | driver | `{ status: ONLINE \| OFFLINE }` → `{ profile }`; `403 NOT_VERIFIED` until approved, `409 ON_RIDE` while `BUSY` |
| `PATCH /drivers/me/vehicle` | driver | `{ vehicleModel?, capacity? }` → `{ profile }` |
| `POST /drivers/me/documents` | driver | multipart `file` + `type` ∈ `LICENSE \| VEHICLE_RC \| ID_PROOF` → `201 { document }` |
| `GET /drivers/me/dashboard` | driver | **unwrapped** `{ profile, stats, daily, ratingBreakdown, recentRides }` |

`stats` carries `totalRides, totalEarnings, totalDistanceKm, todayRides, todayEarnings, ratingAvg, ratingCount`; `daily` is 14 days of `{ day: 'YYYY-MM-DD', rides, earnings }`.

## Admin (role `ADMIN`)

| Method & path | Returns |
|---|---|
| `GET /admin/overview` | `{ todayCounts, totalToday, completionRateToday, activeRides, onlineDrivers, pendingDrivers, avgWaitSec, totalUsers }` |
| `GET /admin/rides/live` | `{ rides }` — everything non-terminal, with passenger/driver display fields |
| `GET /admin/drivers?verification=PENDING` | `{ drivers }` — profiles with `user` and `documents` |
| `POST /admin/drivers/:id/verification` | `{ status: APPROVED \| REJECTED, note? }` → `{ driver }` |
| `GET /admin/analytics/demand?days=14` | `{ windowDays, byHour[24], byWeekday[7], hotspots, peakHour }` |
| `GET /admin/analytics/forecast?hours=12` | `{ forecast: [{ forHour, total, topZones[≤3] }] }` |
| `POST /admin/analytics/forecast/recompute` | `{ ok, rows }` — manual run of the hourly job |

## Rate limits

All `/auth/*` endpoints share a per-IP limiter of 50 requests per 15 minutes (standard `RateLimit-*` headers). Exceeding it returns plain `429 Too Many Requests`.
