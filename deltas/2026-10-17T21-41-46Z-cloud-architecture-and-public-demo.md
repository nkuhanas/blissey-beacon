# Approved delta: cloud architecture and public demo

Date: 2026-10-17 (UTC)
Status: Approved by the user after review of the proposed delta in this session.
Canonical specification: [PROJECT_SPEC.md](../PROJECT_SPEC.md)
Entrypoint: [SPEC.md](../SPEC.md)
Baseline: `20ab349` (`origin/main` pulled before this change).
Scope: Documentation only. No application code, manifests, dependencies, service
provisioning, training or deployment. Selected integrations remain unimplemented
and unverified; acceptance criteria describe future evidence.

## Previous and revised requirements

| Sections | Previous | Approved revision | Rationale |
| --- | --- | --- | --- |
| 1, 4–6, 18, 21, 28, 30 | Backend framework, database and hosting unresolved; laptop middleware considered during planning | One Railway Node.js/TypeScript backend; Supabase PostgreSQL/Realtime; Vercel frontend; no MacBook/home GPU runtime dependency | Resolve MVP infrastructure while retaining QNX inference; laptop middleware was considered, not an established implemented architecture |
| 13, 17, 22, 27 | Proposed small open-source Model 2, candidate Qwen2.5-0.5B-Instruct, possible Veri SFT; serving unresolved | Gemini API with model/version/configuration TBD; preserve four-field output and deterministic fallback | Remove self-hosted generative serving and fine-tuning from MVP runtime |
| 16–18, 25–28 | Async explanations proposed without durable pending-work contract | Transactionally persist event, incident and pending job before ACK; leased jobs, restart recovery, idempotency, timeouts, bounded retry and terminal fallback | Gemini failures must not suppress incidents or strand work; Realtime is not a queue |
| 9, 15–17, 23, 25–26 | v1 uses event_type possible_fall and scalar fall_score | Seven-field event v2 uses event_type inference_result and confidence_scores with fall/non_fall; prediction and Gemini input use named scores | Explicitly supersede categorical schema while preserving the binary classifier and event grouping |
| 3–5, 18–20, 23–26 | Authenticated staff with assigned rooms and RBAC; families excluded from dashboard | Public fictional demo dataset and incident actions for every visitor; no operator login | Make the hackathon demo usable without accounts; no verified staff identity claimed |
| 20, 24–26 | Staff-authorized notification dispatch | Explicit visitor review/approval of exact text and preconfigured consented demo recipient; no arbitrary destinations | Preserve human approval and recipient consent without staff authentication |
| 19, 23 | Proposed backend operator WebSocket stream | Supabase Realtime for demo updates; REST snapshots/history on load/reconnect; old stream proposal superseded | Avoid competing live-update mechanisms; preserve durable recovery |
| 24–32, README | Acceptance, risk, roadmap and ADR statements based on earlier selections | Reconcile planned checks and selected architecture; append ADR-011–018; retain historical decisions and status evidence | Keep one consistent canonical specification without claiming implementation |

## Schema change and compatibility

Previous seven-field event:

```json
{"event_id":"evt_102","room_id":"room_102","device_id":"pi_102","event_type":"possible_fall","fall_score":0.91,"detected_at":"2026-10-17T14:32:06-07:00","sensor_status":"connected"}
```

Revised seven-field event:

```json
{"event_id":"evt_102","room_id":"room_102","device_id":"pi_102","event_type":"inference_result","confidence_scores":{"fall":0.91,"non_fall":0.09},"detected_at":"2026-10-17T14:32:06-07:00","sensor_status":"connected"}
```

The published Model 1 output changes from `{"fall_score":0.91}` to
`{"confidence_scores":{"fall":0.91,"non_fall":0.09}}`.
The binary sigmoid remains unchanged: fall = p; non_fall = 1 - p. Scores are finite,
bounded and uncalibrated. No new activity classes or localization are implied.
QNX still emits grouped episodes, not continuous scores.

This is a breaking payload revision, explicitly superseding ADR-004. Retain the
proposed `wss://<backend>/api/devices/v1/stream` endpoint as approved; its name does
not make the revised payload unchanged v1. There is no evidenced deployed consumer.
Chloe/Chace must agree the payload contract before implementation; legacy acceptance
or route migration requires a separate explicit agreement. No extra required fields.

## Preserved contracts

- ESP32 RX to Pi via USB serial; QNX preprocessing, local binary CNN and temporal grouping.
- Stable event IDs, authenticated persistent WSS, device/room identity validation,
  periodic health, bounded local outbox, reconnects and at-least-once deduplication.
- Durable event/incident persistence before successful ACK; jobs now join that transaction.
- Incident lifecycle, revision checks, false-alarm outcome, audit and idempotent mutations.
- Model 2 output keys: event_id, title, description, recommended_action. No raw CSI,
  reclassification, invented activity/position, diagnosis, confirmed-fall or invented
  staff/emergency response. Generation never authorizes notifications.
- Photon consent, exact content review, approval records, idempotency and delivery
  uncertainty. Staff authentication is explicitly superseded only for demo access.
- Existing REST route names, room-centric dashboard, fixture multi-room layouts;
  actual multi-room sensing remains outside the confirmed single-room MVP.
- Hardware/training ownership and priorities, dataset separation, held-out evaluation,
  unrelated sponsor requirements and honest synthetic/live evidence boundaries.

## Superseded assumptions and unresolved decisions

Railway/runtime and Supabase selections resolve the earlier infrastructure TBDs.
Open-source Model 2/Veri SFT is superseded for MVP inference, not claimed as integrated.
Gemini use cannot establish Veri participation/eligibility. A separate Veri effort
requires a compatible open-source model and documented training/sponsor evidence.
Authenticated operator RBAC and family exclusion from the public demo dashboard
are superseded; device authentication and server-held secrets remain mandatory.

Still unresolved: Railway deployment feasibility and operational limits; Gemini
model/version, structured-output compatibility, timeout/retry configuration and
provider retention; Supabase schema, claim/lease SQL and public demo RLS/projections;
frontend framework/Vercel deployment; precise response bodies; patient-to-room
assignment; QNX persistence/runtime compatibility; Photon product/lead, provider
capabilities and delivery evidence. Chace and Kiro jointly finalize demo access.
No production medical compliance or live integration claim is made.

## ADR and validation

PROJECT_SPEC Section 31 appends ADR-011 through ADR-018 covering Railway, Supabase,
Gemini, no local intermediary, durable explanation jobs, Veri implications, schema
supersession and public demo access respectively. Earlier ADRs remain historical.

Future acceptance must prove post-commit ACK, deduplication, immediate Vercel
incidents without Gemini, validated persisted explanations and Realtime updates,
fallback, restart/lease recovery, lifecycle correctness and explicitly approved
Photon contact. Fixtures/mocked responses must be labeled synthetic and cannot
prove live hardware/provider integration. This delta itself performs no such tests.
