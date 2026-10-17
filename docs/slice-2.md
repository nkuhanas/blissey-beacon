# Slice 2: ingestion and frontend handoff

Scope: authenticated device stream, transactional incidents and pending jobs,
health, operator read APIs and Realtime incident invalidation. No Gemini worker,
Photon, incident mutations, new classifier capabilities or event schema changes.

## Device protocol

Endpoint remains `/api/devices/v1/stream`; payload is the approved v2 schema.
At deployment, Railway terminates TLS: devices use `wss://<backend>/api/devices/v1/stream`.
Plain WS is for isolated local tests only; hosted TLS and actual Pi/QNX networking
need their own evidence. Credentials belong in `Authorization: Bearer <opaque-token>`.
They map to an existing device/room; only a SHA-256 digest is stored. Rotate by
provisioning a new digest and revoke old rows with revoked_at. Tokens never appear
in payloads, URLs, logs or frontend code.

Upgrade authentication precedes socket acceptance. Each event/health transaction
rechecks the active credential and current room mapping while holding shared locks
against concurrent revocation/reassignment. Valid event ingestion inserts event,
incident and pending explanation job on one checked-out pg client. Event-ID
uniqueness and ON CONFLICT serialize simultaneous retries. JSONB payload equality
ignores object key order; changed facts or another device's ID reuse reject.
Successful ACK is sent only after COMMIT resolves. Lost ACKs require exact retries;
database errors never produce a success ACK. Restart deduplication is database-backed.

Frames are bounded to 16 KiB; each connection serializes a maximum of 64 pending
messages. Invalid JSON/schema/score sums yield invalid_payload. A missing event ID
uses the error-envelope correlation sentinel `unknown`, never an invented event.
Conflicts and identity errors are non-retryable; storage_unavailable is retryable.
Revoked credentials close an existing connection after rejection.

Health uses the canonical separate schema. It persists sensor/model state, clock
quality, reported frame time and outbox/drop counts without creating incidents or
sending event_ack. Device status uses server receipt age (stale after 30 seconds),
not socket ping/pong, and keeps offline/degraded distinct from monitoring. Older
reported timestamps cannot overwrite a newer saved health message.

## Operator read contract (frontend ownership handoff)

The existing spec names Kiro / Frontend Team as UI owner; no separate owner review
is claimed here. Shared `packages/contracts/schemas/incident.json` and generated
`Incident` are the concrete handoff for review. Existing UI design/room DTOs remain.

- `GET /api/operator/incidents?facility_id=<id>&limit=25&cursor=<incident-uuid>`
  returns `{ incidents: Incident[], next_cursor: string | null }`. Limit is 1–100;
  default 25. Order is server creation time then UUID, descending. The cursor points
  to a prior row in that facility; an absent/nonmatching cursor yields an empty page.
- `GET /api/operator/incidents/:id` returns `{ incident: Incident }`. Missing or
  unauthorized incidents return 404; malformed UUIDs return 400.
- `GET /api/devices/status?facility_id=<id>` returns `{ devices: [...] }`, with
  monitoring_status (`offline`, `degraded`, `monitoring`) and no credential fields.

All routes require a verified Supabase operator JWT and query facility membership;
JWT identity alone is insufficient. Cross-facility history is forbidden and detail
queries conceal other facilities' incidents. The DTO contains IDs, room/facility,
status/revision, device, detection/receipt/create times, named scores, sensor status,
explanation status and allowed_actions. No event payload, jobs or secrets leak.
All newly created explanations are pending; allowed_actions is empty because
incident mutations and enrichment are not implemented in Slice 2.

Realtime publishes the safe incidents metadata row, not the complete REST DTO.
The migration adds facility_id for scoped filtering; the existing SELECT grants,
room/membership RLS and supabase_realtime publication remain authoritative. Clients
subscribe with their operator session JWT and `facility_id=eq.<facility>`; on a
notification refetch REST. RLS is the boundary even if a client removes its filter.
Fetch on initial load and each successful resubscription/reconnect; missed changes
are not a durable queue. The minimal frontend helper/list is in apps/web/src/incidents.ts
and main.tsx. Kiro can replace presentation while preserving these contracts.

## Local tests and acceptance

```sh
docker compose build toolchain
docker compose run --rm verify
docker compose down
sh scripts/verify-realtime.sh
```

verify uses a fresh disposable database. It includes valid/malformed events,
unauthorized/revoked devices, room mismatches/reassignment, concurrent duplicates,
conflicting IDs, API authorization/pagination, health, restart and lost-ACK retry.
A deferred commit gate proves neither ACK nor incident is visible before commit;
a deferred commit failure proves all three writes roll back and no success ACK
escapes. Retrying after recovery persists exactly one result.

The separate Realtime check uses the official supabase/realtime image and a local
PostgreSQL wal2json decoding plugin, real logical replication and RLS. Test-only
auth.users/auth.uid contracts and signed identities replace GoTrue; production is
never contacted. Ephemeral test keys are gitignored. CI runs both suites in Docker.
No test result establishes actual QNX, hosted Railway/Vercel, production Supabase,
Supabase Auth issuance, Gemini or Photon integration.

## Verification record (2026-10-17)

Docker lint/format/typechecks and production builds passed. The PostgreSQL suite
passed all ten tests (foundation plus nine ingestion/API/health/recovery cases).
The separate actual Realtime test passed: simulator event created one durable
incident, authorized REST read succeeded, authorized subscription observed it,
the no-membership identity observed no change, and an identical retry remained one
incident. Local identities/events are synthetic; GoTrue/hosted Auth was not run.
The Railway production image built and passed a network-isolated process-health
smoke. Production Supabase, Railway, Vercel and DNS were not modified or verified.
