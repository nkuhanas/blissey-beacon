# Gemini explanation pipeline

This slice extends the verified synthetic ingestion path with durable explanation
processing. It preserves the seven-field v2 event and four-field explanation
schemas. Incident history/detail can include the persisted explanation; the
provisional frontend renders it using the existing Realtime invalidation/refetch.
Paper design work and incident actions remain separate work.

## Data path

1. The permanent simulator sends a canonical event to authenticated device ingestion.
2. The existing transaction persists the event, incident and pending job before ACK.
3. A worker in the same backend deployment claims a job with a unique lease token,
   freezes minimal structured facts and records a canonical input hash/prompt version.
4. Gemini receives only those facts and the constrained output schema. A provider
   outage does not block ingestion or the initial incident publication.
5. Completion transactionally stores the explanation, finalizes the job, and advances
   the incident revision. The existing incident Realtime subscription sees the commit.
6. The frontend refetches authorized REST history and renders the persisted result.

The `explanations` table stores output, event/incident identity, source, actual model
version, prompt version and input hash. It has RLS enabled and no anon/authenticated
SELECT grant. Browser clients obtain bodies through facility-authorized REST;
internal jobs and provenance stay server-side. Realtime remains an invalidation
mechanism, not a durable queue.

## Output and recovery

Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) passed a live structured-output probe.
The older 2.5 Flash-Lite appeared in the model list but rejected new-user generation;
model listing alone does not verify compatibility. The model is explicit runtime
configuration rather than an automatically changing `latest` alias.

The initial prompt (`grounded-phrasing-v1`) lets Gemini select among exact factual
wordings built from persisted room, timestamp and experimental scores. Backend
validation independently checks the unchanged explanation schema, event identity
and allowed wording. Arbitrary paraphrasing, added observations, diagnosis,
physical localization, staff actions and notification authorization are rejected.
This deliberately limits generation to explainable wording choices.

Each HTTP attempt has a five-second timeout and a 64 KiB response limit. Transient
network/429/5xx failures get one retry (two attempts total), with a two-second
persisted retry delay. Invalid output or other provider rejection immediately
persists a deterministic same-schema fallback. Error records contain safe codes,
not keys, provider bodies or prompts.

Claims use PostgreSQL row locks with `SKIP LOCKED` and 30-second leases. Completion
and retry check the current token and lease. Expired work is recoverable after
restart; a lost final attempt produces a fallback without a third provider call.
Input hashing is canonical across JSONB key reordering. Graceful shutdown aborts
in-flight generation and leaves its durable lease available for recovery.

## API compatibility

Request `include_explanation=true` on either existing incident route:

- `GET /api/operator/incidents?facility_id=demo_facility&include_explanation=true`
- `GET /api/operator/incidents/<id>?include_explanation=true`

An opted-in incident has `explanation: null` while pending, then the canonical
four-field object when `explanation_status` is `ready` or `fallback`. Without the
flag, the previous response shape is retained for older strict-schema clients.
This permits frontend/backend deployments to roll independently. Authentication,
facility boundaries and `allowed_actions: []` remain enforced.

## Docker verification

```sh
docker compose run --rm verify
sh scripts/verify-realtime.sh
```

The default checks use synthetic Gemini responses and disposable databases.
With `GEMINI_API_KEY` and `GEMINI_MODEL` in the Git-ignored `.env.deploy.local`, run:

```sh
sh scripts/verify-realtime.sh --live-gemini
```

This explicit mode calls Google with a synthetic event, while PostgreSQL, operator
identities and the actual Realtime engine remain local and disposable. Only the
Gemini key/model are passed from the deployment file to the checker. The database
connection stays hard-coded to the isolated stack. Hosted database credentials
are not used, and test bootstrap/reset SQL never targets Supabase production.

On 2026-10-17, the full Docker suite passed, including 17 database tests covering
atomic completion rollback, competing claims, stale workers, frozen snapshots,
bounded retries, corrupt input and shutdown recovery. The explicit live-Gemini
mode passed canonical simulator ingestion, pending incident read, actual Google
structured output, database persistence, actual Realtime UPDATE, authorized REST
read and no-membership exclusion. This does not establish a hosted worker rollout,
physical QNX integration, model accuracy, Paper design parity or Photon.

## Hosted rollout

Completed against the approved demo on 2026-10-18 UTC: the third migration was
recorded, Railway's key/model configured, and a fresh synthetic event produced a
real Gemini explanation with authorized REST and hosted Realtime update. See the
[verification record](deployment-verification.md#hosted-gemini-rollout--2026-10-18-utc).
The procedure below remains the rollout reference; do not reapply recorded migrations.


1. Review and back up the approved demo project. Apply only the new
   `20261018001000_explanations.sql` after the existing two migrations and record its
   version. Do not rerun seed/reset scripts or earlier migrations.
2. Deploy the PR's backend/frontend after merge. The incident schema extension is
   optional and explanation bodies are opt-in, preserving older client behavior.
3. Set server-only `GEMINI_API_KEY` and `GEMINI_MODEL=gemini-3.5-flash-lite` in Railway.
   Both are required to enable the worker. With no key, ingestion runs and work
   stays pending. Never add either credential to a `VITE_` variable.
4. Existing pending jobs will be claimed. Send a new clearly labeled synthetic
   event, observe pending → ready/fallback in REST and the browser, verify model/hash
   provenance, and resend the identical event to check durable deduplication.
5. Record hosted results separately; the earlier hosted Slice 2 verification is
   not evidence that this new worker or migration is already deployed.

No additional backend service, external queue, provider SDK dependency, lifecycle
mutation or notification integration is introduced by this slice.
