# Security Model

The platform is a campus deployment, but the auth and data-handling design follows production norms rather than demo shortcuts. This page describes what is protected, how, and where the deliberate demo-only simplifications live.

## Sessions: short access token + rotating refresh cookie

Login issues two credentials. The **access token** is a 15-minute JWT (HS256, `JWT_ACCESS_SECRET`) carrying only `sub` (user id) and `role`; the web client keeps it **in memory only** — never `localStorage` — so XSS cannot exfiltrate a long-lived credential. The **refresh token** is a 48-byte random opaque string delivered as an `httpOnly`, `SameSite=Lax` cookie named `scm_refresh`, path-scoped to `/api/v1/auth` so it never rides along on ordinary API calls. `Secure` is enabled outside development.

Only the **SHA-256 hash** of the refresh token is stored (`RefreshToken.tokenHash`), so a database leak does not yield usable sessions. Every `POST /auth/refresh` **rotates**: the presented token is verified by hash, revoked, and replaced in one transaction — a replayed old token fails with `401 REFRESH_INVALID`, which also serves as a theft signal. Logout revokes server-side and clears the cookie. The axios layer holds a single-flight refresh lock so a burst of concurrent 401s produces exactly one rotation.

## Authorization

REST middleware (`requireAuth`, `requireRole`) gates every protected router; the same JWT validates the Socket.IO handshake, and room joins are derived from the verified identity, never from client claims. Object-level checks back this up: ride mutations verify the caller is the ride's passenger or assigned driver (`403 NOT_YOUR_RIDE`), drivers cannot go online before an admin approves their profile (`403 NOT_VERIFIED`), and `ride:subscribe` confirms participation before joining the location room. The `scm_role` cookie used by Next.js middleware is a **routing hint only** — every privileged decision happens at the API.

## Trip-start OTP

Each ride carries a server-generated 4-digit `startOtp`. The passenger UI surfaces it prominently; the driver UI never renders it and instead asks the driver to type what the passenger reads out. The state machine refuses `ACCEPTED → IN_PROGRESS` unless the submitted code matches (`400 BAD_OTP`), which makes "started the trip" require a real handoff between the two parties and stops fare-state manipulation by a driver acting alone. (The code does travel in ride payloads to both participants — the enforcement point is the transition check, with the UI split providing the human verification step.)

## Input validation and transition integrity

Every body and query string passes a Zod schema before reaching business logic; failures return structured `400 VALIDATION_ERROR` details. State changes are additionally enforced by guarded conditional writes (`WHERE id AND status = expected`), so even a hand-crafted request hitting the right endpoint at the wrong moment lands on `409 ILLEGAL_TRANSITION` / `409 RIDE_TAKEN` instead of corrupting a ride (full mechanics in `ARCHITECTURE.md`).

## Passwords, rate limits, transport hardening

Passwords are bcrypt-hashed (cost 10) with a minimum policy of 8 characters including a letter and a digit; `passwordHash` is stripped from every serialized user. All `/auth/*` routes sit behind a per-IP limiter (50 requests / 15 min) to blunt credential stuffing. `helmet` applies standard security headers, CORS is an explicit origin allow-list with credentials, JSON bodies are capped at 1 MB, and `trust proxy` is set so rate limiting and logging see real client IPs behind nginx.

## Uploads

Driver documents go through multer with an 8 MB cap into either local disk (`/uploads`, served statically) or S3 when configured. Stored filenames are server-generated keys — user-supplied names never touch the filesystem path.

## Demo-only simplifications

Compose ships placeholder JWT secrets (rotate via env for any real deployment), runs Postgres/Redis without TLS on the internal network, and leaves uploaded documents readable by URL rather than behind signed links. Payments are simulated end-to-end. Each of these is an environment/config change, not a design change.
