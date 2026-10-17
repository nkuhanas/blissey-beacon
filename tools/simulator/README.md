# Synthetic QNX WebSocket client

This permanent integration tool uses the valid event in
`packages/contracts/fixtures/inference-events.json`. It is synthetic desktop/Docker
traffic, never evidence of actual QNX networking, CSI inference or clinical accuracy.
The established seven-field v2 event schema is unchanged.

## Run

Apply the application migrations in a dedicated development database, seed fictional
rooms/devices, and configure apps/backend/.env as documented in docs/development.md.
Create a random opaque device token, place DEVICE_ID and DEVICE_TOKEN in that
backend .env and provision its digest:

```sh
docker compose run --rm toolchain pnpm --filter @blissey/backend provision:device
```

The command does not log the token. It requires an existing device row and stores
only SHA-256(token). Never commit tokens or put them in a WebSocket URL. Revocation
sets device_credentials.revoked_at; existing streams recheck it on every message.

Copy this directory's .env.example to .env and set the same token. Start the backend
with `docker compose up backend`, then run:

```sh
docker compose run --rm toolchain pnpm simulate
```

Use WSS outside local development. Plain WS is limited to loopback and the local
Docker backend hostname. Certificate verification remains enabled. Retryable
failures reconnect with bounded jittered retries using the identical event ID,
timestamp and facts; authentication/schema/conflict rejection stops immediately.
Successful output is an event_ack explicitly labeled synthetic. The client sends
health on connect and every ten seconds until it receives the event ACK.

The fixture's default ID intentionally deduplicates repeat runs. Set EVENT_ID to a
new stable ID only for a new synthetic episode. Health never receives an event_ack.

## Real Realtime acceptance without production

Run `sh scripts/verify-realtime.sh` from the repo root. It starts an isolated
PostgreSQL + actual Supabase Realtime stack with synthetic signed identities,
uses this simulator library against the real backend, verifies one persisted
incident through REST and Realtime, retries it and checks no duplicate incident.
An identity without facility membership must receive no incident notification.
The script cleans its own containers/volumes. It never reads production credentials.
It does not start GoTrue or prove hosted Supabase Auth issuance or Pi/QNX TLS support.
