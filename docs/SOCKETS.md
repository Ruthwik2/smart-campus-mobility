# Real-time (Socket.IO) Reference

Endpoint: same origin as the API, path `/socket.io` (nginx proxies the upgrade). Transport is WebSocket-first. Horizontal scale is handled by the `@socket.io/redis-adapter`, so these semantics hold across any number of API replicas.

## Handshake

The client sends the current access token in the connection auth payload:

```ts
io(API_URL, { path: '/socket.io', transports: ['websocket'], auth: { token: accessToken } });
```

Invalid or missing tokens are rejected at handshake. Because access tokens are short-lived, the client reconnects with a fresh token after refresh; the server does not re-validate mid-connection.

## Rooms

On connect every socket joins `user:{userId}`; drivers whose profile is `ONLINE`/`BUSY` also join `drivers:online`; admins join `admins`. Membership in `ride:{rideId}` is explicit — a participant opts in with `ride:subscribe` — because location streams should reach exactly the people on that ride.

## Client → server events

| Event | Payload | Who | Effect |
|---|---|---|---|
| `ride:subscribe` | `{ rideId }` | ride participant | join `ride:{rideId}` (membership is verified server-side) |
| `ride:unsubscribe` | `{ rideId }` | participant | leave the room |
| `driver:location` | `{ lat, lng }` | online driver | updates the Redis GEO index; persisted to Postgres at a throttled rate; rebroadcast (see below) |

## Server → client events

| Event | Payload | Rooms | When |
|---|---|---|---|
| `ride:requested` | `{ ride }` | `drivers:online`, `admins` | a new request hits the board (also on scheduled promotion and driver bail) |
| `ride:update` | `{ ride, previousStatus? }` | `user:{passengerId}`, `user:{driver.userId}`, `ride:{id}`, `admins` | any status transition or assignment change |
| `ride:unavailable` | `{ rideId, reason: 'TAKEN' \| 'CANCELLED' \| 'EXPIRED' }` | `drivers:online`, `admins` | a board entry stops being acceptable |
| `driver:location` | `{ driverId, lat, lng, rideId? }` | `ride:{rideId}` (when on a ride), `admins` | each accepted location ping; `driverId` is the **DriverProfile id** |
| `driver:presence` | `{ driverId, status }` | `admins` | a driver goes online/offline/busy |

Payload note: every `ride` object is the full API serialization (passenger, nested driver profile + user, fares, `startOtp`), so clients can replace local state wholesale instead of patching.

## Disconnect grace

When a driver socket drops, the server starts a **45-second grace timer** before flipping `ONLINE → OFFLINE` (a `BUSY` driver is never auto-flipped). A reconnect within the window cancels the timer, so brief Wi-Fi flaps don't remove a working driver from dispatch. The eventual flip emits `driver:presence` to admins.

## Client binding pattern

The web app binds all listeners exactly once per connection inside the `live` Zustand store (`web/src/stores/live.ts`), keyed by the logged-in user id. Ownership of a `ride:update` is decided by `ride.passengerId === selfId || ride.driver?.userId === selfId` — note the indirection, since `ride.driverId` is a profile id, not a user id. Passenger screens additionally `ride:subscribe` while a ride card is mounted, which is what makes the live distance-to-pickup tick.
