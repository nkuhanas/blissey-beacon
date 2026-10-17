# Development

## Docker toolchain

Prerequisite: Docker Engine and Compose v2. The Node 24/pnpm toolchain is built
from the root Dockerfile. Named volumes hold Linux dependencies; host Node/pnpm
is not required. Source edits and build outputs are bind-mounted.

```sh
docker compose build toolchain
docker compose run --rm toolchain
```

The default toolchain command installs the frozen lockfile, checks generated
contracts, lints/types/tests the apps and builds both. Contracts build before app
typechecks because the apps consume their package exports.

To regenerate committed TypeScript after changing authoritative schemas:

```sh
docker compose run --rm toolchain pnpm contracts:generate
```

## Isolated database verification

```sh
docker compose run --rm verify
docker compose down
```

`verify` starts a PostgreSQL 17 container with tmpfs storage and no published port.
It runs all foundation checks and the database test against an empty database.
Stop/remove that database using `down` before rerunning the migration test. Never
point TEST_DATABASE_URL at a hosted or persistent database: bootstrap assumes an
empty disposable instance. The test bootstrap emulates only Supabase roles,
auth.users/auth.uid and the publication; it does not run Supabase Auth or Realtime.

The test applies the actual migration and fictional seed, exercises authenticated
RLS and missing-membership/anonymous denial, checks publication membership, tests
real transaction rollback after event/incident/job writes and database uniqueness.
This is not yet a full ingestion/deduplication or post-commit ACK integration test.

## Configure and start the apps

Copy apps/backend/.env.example to apps/backend/.env and apps/web/.env.example to
apps/web/.env. Configure a dedicated Supabase demo project, apply the migration
and seed with your migration workflow, and create a fictional operator account
through Supabase Auth. For a fresh project, run the foundation migration in
the Supabase SQL editor, then run supabase/seed.sql; record migration application
in your team workflow before subsequent schema changes. Never commit credentials. Disable public sign-up for the
demo project; account provisioning is an explicit operator/team step.

Add the provisioned account's UUID to facility_memberships for demo_facility using
an administrative connection. Do not grant membership from browser-controlled
claims. A single shared account is acceptable but cannot identify individual staff.
The browser receives only the Supabase publishable key; it never receives the
PostgreSQL password or service-role/Gemini/Photon keys.

Use an asymmetric Supabase signing key (ES256/RS256); Railway verifies the JWKS
signature, exact issuer, authenticated audience/role, expiry and subject. Legacy
HS256 signing is deliberately unsupported. Set DATABASE_URL to the provider's
direct/session-pooler connection using verified TLS and WEB_ORIGIN to the browser
origin. If local ports are occupied, set WEB_PORT/BACKEND_PORT for Compose and
update WEB_ORIGIN/VITE_API_URL to match. The backend checks database facility membership independently of JWT claims.

```sh
docker compose run --rm toolchain
docker compose up backend web
```

Web: http://localhost:5173. Backend process liveness: http://localhost:3001/healthz.
The backend requires configured environment values; liveness does not verify any
provider. Browser login uses Supabase Auth; room reads send the session JWT to
Railway. Rooms Realtime subscribes with the same session and RLS. Publication
includes rooms/incidents; no explanation worker or incident ingestion exists yet.
Initial load, subscription establishment and reconnect trigger REST room refetch.

A missing web configuration shows a setup state. Login and room loading need a
real/local Supabase project, provisioned identity and migrated database; they are
not simulated as successful when unavailable. Hosted deployment is a separate step.

## Ownership and later slices

- Chace: apps/backend, packages/contracts, supabase migrations/access policies.
- Kiro: apps/web; agree the provisional room layout DTO and coordinate units.
- Chloe: QNX native schema parity and Python/Colab; independent toolchains.
- Emilia: firmware/serial configuration and hardware evidence.

The current room schema includes floor and optional static x/y/width/height.
Fictional patients and timestamped assignments express configured occupancy,
not inferred within-room position. Historical incident assignment must be resolved
at event time. Do not silently use the current occupant for older incidents.

Slice 2 adds actual transactional ingestion, payload comparison on duplicate IDs,
health and authorized live incident UI. Register @fastify/websocket before routes
and attach message listeners synchronously. As soon as that basic endpoint exists,
Chloe must send one synthetic event from the actual Pi running QNX over authenticated
TLS WSS, before waiting for the CNN. Record runtime/version, TLS trust, credential
identity, payload and durable ACK evidence. A desktop simulator does not pass this
hardware milestone. Keep the simulator as a permanent tool when introduced.

Slice 3 adds durable Gemini claims/retries/fallback and complete incident/Photon
workflows. No worker/notification scaffolding or empty future directories are needed
now. No live integration, native parity or trained-model result is claimed.

## Foundation verification record

Local Docker checks on 2026-10-17 passed generated-contract drift detection,
ESLint/Prettier, TypeScript, eight contract tests, signed synthetic JWT/facility route tests,
and both production builds. The real PostgreSQL test passed migration/seed, RLS
denials, publication membership, assignment facility integrity, uniqueness and
rollback after event/incident/job writes. JWT tests use generated local keys;
Supabase Auth issuance and hosted Realtime have not been tested. Browser rendering
QA was unavailable; a web build is not visual verification. The Docker Vite HTTP
entrypoint smoke check passed.
