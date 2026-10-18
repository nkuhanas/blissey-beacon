# Blissey Beacon

Blissey Beacon is an experimental, camera-free possible-fall monitoring project
for LA Hacks 2026, intended for senior-home operators, caregivers, and authorized
family members. ESP32 Wi-Fi CSI feeds local inference on a Raspberry Pi 5 running
QNX, with a planned Railway Node.js/TypeScript backend, Supabase PostgreSQL and
Realtime, Gemini API explanations, and an authenticated React/Vite demo dashboard.
Supabase Auth and facility membership protect operator data/actions. A shared demo
operator account is acceptable. Notifications require explicit review and a
saved consented demo contact. Planned conversational calls use ElevenLabs Agents
through Photon SIP, with operator-approved frozen context and opening; this
integration remains unimplemented. No developer laptop is required at runtime.

This repository implements **Slice 2 plus the explanation pipeline**: authenticated device WebSocket ingestion,
transactional event/incident/job persistence, durable deduplication, device health,
operator incident reads, a canonical-fixture simulator and minimal incident
Realtime subscriptions. Durable Gemini processing and persisted explanation reads
are implemented; live Gemini with local PostgreSQL/Realtime was verified. Hosted
worker rollout is pending. ElevenLabs/Photon calls and incident actions remain unimplemented. Hosted synthetic
integration and dashboard sign-in/live updates were verified on 2026-10-17;
actual QNX integration remains unverified. See the
[deployment verification record](docs/deployment-verification.md), [PROJECT_SPEC.md](PROJECT_SPEC.md)
and the [Slice 2 handoff](docs/slice-2.md) for scope and verification boundaries.
This is a proof of concept, not a clinically validated detector or emergency device.

See [docs/gemini-pipeline.md](docs/gemini-pipeline.md) for the simulation, opt-in
explanation DTO, failure/recovery behavior and rollout steps.

Frontend design work must use **Paper**, with linked screen references implemented
in `apps/web` and deployed to Vercel. The current dashboard is a provisional
integration shell. [Paper drafts and the editorial brand handoff](docs/frontend-design.md)
are available; implementation of those designs and visual parity remain pending.

Demo site: **https://blissey-beacon.health**. For Vercel, Railway, Supabase,
DNS and per-provider variables, follow [docs/deployment.md](docs/deployment.md) and
[root .env.example](.env.example). The user approved the previously provisioned
Supabase project for fictional demo setup; isolated Docker tests still never use it.

## Getting started

Install Docker with Compose. Node and pnpm run inside the toolchain container.

```sh
docker compose build toolchain
docker compose run --rm toolchain
```

Run migration/access/transaction checks against a disposable test database:

```sh
docker compose run --rm verify
docker compose down
```

The database test requires a fresh database. `docker compose down` removes its
container and tmpfs data; dependency volumes are retained. No hosted database is
used by this check. For actual local Supabase Realtime acceptance, run
`sh scripts/verify-realtime.sh`; this uses isolated synthetic identities and never
connects to production. See [docs/development.md](docs/development.md) for app startup,
operator provisioning, schema generation and verification boundaries.

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant sections of
[PROJECT_SPEC.md](PROJECT_SPEC.md). `SPEC.md` remains the compatibility entrypoint.
Grow modules with each slice; QNX and Python keep independent toolchains.

## Changes to the specification

If proposed work contradicts [PROJECT_SPEC.md](PROJECT_SPEC.md), pause the
conflicting work and first propose a specification change and a timestamped Markdown delta file in
`deltas/` (for example, `deltas/2026-10-17T19-30-00Z-short-description.md`).
Describe the affected spec sections, the proposed changes, and why they are
needed. Obtain explicit approval before editing the spec, creating the delta
file, or implementing the conflicting work.

Once approved, update `PROJECT_SPEC.md` and create the timestamped delta file
documenting what changed in the spec and why. Include the affected sections and the previous
and revised requirements so the decision can be traced. Then proceed with the
approved work.
