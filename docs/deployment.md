# Deployment setup: blissey-beacon.health

Planned public website: **https://blissey-beacon.health** on Vercel.
Planned backend: **https://api.blissey-beacon.health** on Railway, with
`wss://api.blissey-beacon.health/api/devices/v1/stream` for devices.
Supabase retains its provider-assigned project URL. DNS, TLS, provider configuration
and production integration are not established merely by these files.

Production was explicitly left untouched during development. Start with the isolated
Docker tests; review a Supabase backup and migration plan before applying migrations
to the provisioned production project. Do not reset production or run test bootstrap,
seed/integration test scripts or the test Compose stack against it.

## 1. Supabase

1. In the project dashboard, record the Project URL and **publishable** API key.
   Use an asymmetric Auth signing key (ES256/RS256); this backend verifies the
   project's JWKS, issuer, audience, expiry and authenticated role. Legacy HS256
   operator sessions are unsupported. Do not blindly rotate an existing production
   signing key; inspect existing consumers first.
2. Inspect existing schema/migration history and back up production. The application
   migrations are ordered: `20261017221000_foundation.sql`, then
   `20261017230000_slice2_ingestion.sql`. Apply only unapplied migrations through
   the SQL editor or an existing reviewed migration workflow. The SQL files contain
   transactions; they are not idempotent reset scripts. Existing unrelated tables
   named rooms/incidents/etc. require reconciliation before applying this schema.
3. The foundation migration adds rooms/incidents to `supabase_realtime`; Slice 2
   adds facility_id to incident metadata for filtering. Confirm both tables are
   in that publication and RLS is enabled. No anon SELECT policies or client write
   grants are needed. Keep device credentials, raw event payloads, internal health
   and jobs server-only. Realtime authorization uses operator session JWTs.
4. Provision fictional facility/room/device/patient records intentionally. The seed
   is fictional demo data, but do not apply it to production without review. Create
   an operator account in Supabase Auth, then explicitly insert its Auth user UUID
   and intended facility ID into facility_memberships. Do not enable self-service
   membership assignment. A shared demo login does not identify individual staff.
5. Set Auth Site URL to `https://blissey-beacon.health` and allow only intended
   redirect origins. Current login uses email/password. Provision the test operator
   via the dashboard; public sign-up is not part of this demo. Never put passwords
   in the repo or public VITE_ variables.
6. Obtain the direct PostgreSQL or **session pooler** connection string for Railway.
   Use the exact provider username/host/port; URL-encode password characters. Keep
   TLS verification enabled (`sslmode=verify-full`, with the provider CA installed
   if required). Transaction pooling is not the selected connection mode.

No Supabase service-role key is required for the browser or backend runtime. The
backend's PostgreSQL connection can bypass RLS depending on its role, so scoped
membership queries are mandatory and implemented. Use provider-supported least
privilege for runtime access; do not grant arbitrary database credentials to devices.

## 2. Railway backend

1. Connect this GitHub repo, create one backend service and use the repository root
   as its build context. Root `railway.json` selects `apps/backend/Dockerfile`.
   Keep the service root at `/`; it must include the shared workspace package.
2. Configure only backend variables from root `.env.example`: DATABASE_URL,
   SUPABASE_URL and WEB_ORIGIN=`https://blissey-beacon.health`. Railway provides
   PORT, which the server reads and binds on `0.0.0.0`. Do not upload a local .env
   or set a browser key as a device credential.
3. The production image builds the shared contracts and backend, includes production
   dependencies, runs as a non-root user and starts `node dist/server.js`. WSS, REST
   and future worker logic share this service; no extra worker is deployed.
4. Generate a Railway hostname first, check `/healthz`, and add custom domain
   `api.blissey-beacon.health`. Follow the exact DNS record Railway displays and
   wait for its certificate. The application accepts HTTP behind Railway TLS
   termination; external devices must use WSS with certificate verification.
5. `/healthz` proves process liveness only. Check authorized room/incident reads
   and synthetic ingestion separately before calling the deployment integrated.

## 3. Vercel frontend

1. Import the same repository with project Root Directory **`.`**. Root vercel.json
   installs pnpm's frozen lockfile, builds contracts + apps/web and serves
   apps/web/dist. The SPA rewrite supports future frontend routes. Do not point
   this project at the backend or run the backend as a Vercel function.
2. Set only VITE_API_URL, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and
   VITE_FACILITY_ID from `.env.example`. These are public build-time values. Never
   add DATABASE_URL, device tokens, service-role keys or future provider secrets
   under any VITE_ name. Rebuild when these values change.
3. Add `blissey-beacon.health` in Domains and apply the exact records Vercel gives
   your DNS provider. Wait for TLS. Keep the API subdomain routed to Railway.
4. Sign in using the provisioned operator account. A valid account without facility
   membership must not see incidents. Confirm browser REST calls use the production
   API URL and Realtime uses the Supabase project/session, not the Raspberry Pi.

WEB_ORIGIN is a single allowed browser origin. For preview deployments use a
separate staging backend/origin/project or deliberately configure the specific
preview origin; this code does not trust every vercel.app origin by default.

## 4. Device credential and release check

Provision a device row assigned to its room. Generate a high-entropy opaque token,
then run the backend `provision:device` command from a controlled environment with
DATABASE_URL, DEVICE_ID and DEVICE_TOKEN. It stores only SHA-256(token) and does
not print the token. Do not bake administrative or device credentials into images.
Place the token only on the intended QNX client and approved synthetic simulator.

Run the synthetic fixture with the WSS production endpoint only when you authorize
creating that fictional incident. Verify accepted ACK, one persisted incident,
operator REST read and Realtime notification; resend the identical ID/payload and
expect duplicate ACK with the same incident ID. Revocation sets revoked_at and is
rechecked even on established streams. This check is not performed automatically
against production by CI or deployment.

Actual Pi/QNX authenticated TLS WebSocket smoke remains a separate milestone for
the edge owner. No Gemini or Photon work is included. The site is experimental,
uses fictional residents/staged events and makes no clinical or compliance claims.
