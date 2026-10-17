# Hosted demo verification — 2026-10-17

The Slice 2 demo was deployed from main commit `c63a067` and checked against
hosted providers. This records deployment evidence, without changing architectural
requirements or completing the full hardware acceptance criteria.

| Component       | Verified configuration                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Website         | `https://blissey-beacon.health`, Vercel, repository root build, Node 24, contracts + Vite          |
| Backend         | `https://api.blissey-beacon.health`, Railway, production Dockerfile, one persistent application    |
| Device endpoint | `wss://api.blissey-beacon.health/api/devices/v1/stream`                                            |
| Database        | Supabase PostgreSQL session pooler, verified TLS with provider CA                                  |
| Identity        | Supabase ES256 operator sessions, explicit `demo_facility` membership                              |
| Realtime        | Authenticated facility-scoped subscriptions to published room/incident tables                      |
| Auth settings   | Website Site URL; redirects limited to website and `http://localhost:5173`; public signup disabled |
| DNS/TLS         | Porkbun root A records, API CNAME and Railway ownership TXT; valid website/API certificates        |

The user explicitly approved the previously provisioned production project for
fictional demo setup. Its public application schema was empty before changes.
A schema-only backup was saved locally before applying
`20261017221000_foundation.sql` and `20261017230000_slice2_ingestion.sql`.
Their versions were recorded in `supabase_migrations.schema_migrations`.
Fictional facility, room, resident and device records were provisioned, followed by
operator membership and a device credential whose SHA-256 hash alone is stored.
This is not a claim of a complete database backup or a tested restore.

## Hosted checks

- A canonical-fixture synthetic device event received a post-commit accepted ACK
  and created exactly one inference event, incident and pending explanation job.
- Retrying the identical payload returned a duplicate ACK with the same incident;
  database counts remained one each.
- The operator API returned the incident; unauthenticated operator requests and
  anonymous Supabase incident reads were rejected.
- An authenticated Supabase Realtime subscription received one actual INSERT
  notification. The standalone verification client explicitly set its session
  before creating the channel; no database permissions were broadened.
- Docker Chromium signed into the custom-domain website, displayed Room 102 and
  persisted incident history, observed a second synthetic incident arrive without
  reloading, and signed out. No page errors occurred.
- Retrying that second event through the custom WSS endpoint preserved one
  event/incident/job for its ID. The permanent simulator was used for this retry.

The browser used the public DNS target IPs in its resolver to avoid a stale local
DNS cache. TLS certificate validation stayed enabled. Public DNS-over-HTTPS
checks and provider status independently confirmed the configured records.

## Configuration and limits

See [deployment.md](deployment.md) for the CA startup command, provider variables,
Porkbun ownership verification and credential boundaries. Local credential files,
schema backup and detailed verification receipts are Git-ignored; no management
tokens, passwords, session tokens or device bearer credentials are committed.

The two hosted incidents are fictional synthetic events. This does not verify an
actual Raspberry Pi/QNX connection, native schema parity, trained classifier,
clinical capability, Gemini, incident mutations or Photon. Pending explanation
jobs remain pending because no worker is implemented. Hosted no-membership
exclusion, restart recovery and load/failure behavior were not exercised in this
deployment check; the isolated Docker suite covers its documented scenarios.
Do not run database-reset/bootstrap tests against the hosted project.

The deployed dashboard is a provisional integration shell. Paper remains the
required frontend design tool: link its document/screens, implement those designs
in `apps/web`, and compare the resulting UI with the references. No Paper artifact,
handoff or design parity was verified by these deployment checks.
