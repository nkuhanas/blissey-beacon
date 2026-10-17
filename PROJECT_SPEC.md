# Blissey Beacon — Project Specification

Status: implementation specification for the LA Hacks 2026 proof of concept.
Inspection date: 2026-10-17. Baseline: `8aa999b1047197c01b8813d917429e43ff66b860`.

## 1. Authority, evidence, and current state

This document is the team's single source of truth for scope, architecture,
interfaces, implementation order, and validation. [SPEC.md](SPEC.md) is the
compatibility entrypoint. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for changes.

Requirement labels throughout this document:

- **Required:** supplied explicitly in the project request; implementation must comply.
- **Proposed:** concrete defaults for implementation planning, subject to team acceptance
  before dependent implementation. These are not existing code or measured results.
- **Unverified:** requires repository access, hardware testing, or a team decision.

### Repository inspection

The application repository at the baseline contains only `AGENTS.md`, `README.md`,
`CONTRIBUTING.md`, and placeholder `SPEC.md`. There is no application source,
firmware, dependency manifest, schema, model artifact, training notebook, CI,
build command, or test suite. No stack, deployment provider, individual ownership,
or sponsor SDK can be inferred from the repository. Local `.DS_Store` is unrelated
and excluded from this documentation change.

The supplied request establishes the architecture below but ends mid-sentence in
its positive-recording annotation subsection. Requirements beyond that point
were not received; this document must not imply otherwise.

### External evidence and limitations

- Dataset location supplied by the team: [emiluvu/bb-data](https://github.com/emiluvu/bb-data).
  A read-only GitHub contents request returned 404 on the inspection date. This
  does not establish whether the repository is missing, private, or inaccessible
  to this connection. Its files, schema, license, counts, labels, and collection
  configuration remain unverified. No dataset was cloned or downloaded.
- [Application main branch](https://github.com/nkuhanas/blissey-beacon/tree/main)
  was checked through the connected GitHub API and matched the baseline commit.
- QNX, Paper, and Photon roles come from the supplied request. Exact products,
  versions, licenses, APIs, credentials, and runtime compatibility have not been
  verified. Provider-specific calls must wait for the corresponding decisions.

## 2. Product, scope, and limits

**Required:** Blissey Beacon explores camera-free detection of possible falls for
senior-home operators, caregivers, and authorized family members. Wi-Fi CSI from
ESP32 devices feeds local neural-network inference, with incidents and reviewed
family notifications managed in the cloud.

This is an experimental proof of concept, not a clinically validated fall detector,
medical diagnosis system, or emergency response device. UI, explanations, and calls
must describe a **possible fall** and avoid claims that injury or safety is known.

### MVP

- One room, one person, one ESP32 transmitter, and one ESP32 receiver.
- Controlled staged falls and common normal movements.
- One Raspberry Pi 5 running QNX, reading the receiver over USB serial.
- Model 1: a locally deployed fall-detection neural network.
- Persistent Pi-to-cloud WSS carrying inference events and device health.
- Backend incident storage, authorization, and Model 2 explanations.
- Caregiver dashboard for room status, incident history, and acknowledgments.
- One working Photon workflow to notify or call an authorized family contact,
  subject to consent and staff review.

### Excluded from MVP

Person identification from CSI; full-body pose reconstruction; heart-rate or
breathing estimation; diagnosis; multiple-person tracking; validated cross-facility
performance; raw CSI cloud streaming; automatic family calls without required
staff review and authorization.

Stretch work must not block the end-to-end path: more rooms, improved models,
longer evaluation, advanced dashboard analytics, additional notification channels,
and stronger offline resilience. Multi-person or clinical claims require separate
scope and evidence, not merely a larger model.

## 3. Architecture and responsibility boundaries

```text
ESP32 TX -- Wi-Fi sensing signals --> ESP32 RX
                                         |
                                    USB serial
                                         v
                         Raspberry Pi 5 / QNX
                         serial reader -> preprocessing
                         -> sliding windows -> Model 1
                         -> event logic / local outbox
                                         |
                              persistent WSS client
                                         v
                                Cloud backend
                         WSS server / incident database
                         authorization / Model 2 / notification jobs
                                |                   |
                        REST + live updates       Photon API
                                |                   |
                        Caregiver UI (Paper)   Authorized family
```

**Required transport decisions:**

| Boundary | Contract and responsibility |
| --- | --- |
| ESP32 TX → RX | Wireless Wi-Fi signals used for CSI sensing. Firmware and radio configuration must be matched to collection. |
| ESP32 RX → Pi | Direct USB serial, reading existing ESP32 serial output. No WebSocket on this link. Actual baud, device path, framing, and QNX USB driver must be verified. |
| Pi → backend | Pi is persistent WSS client; backend is WSS server. Send structured inference and periodic device health, not the raw CSI dataset. |
| Backend → Model 2 | Internal function or inference API receiving structured incident facts, never raw CSI. |
| Backend → UI | REST for history and room state; authenticated live updates using WebSocket or an established equivalent. |
| Backend → Photon | Server-side API integration after authorization and staff review. |

### Proposed module boundaries

| Component | Owns | Must not own |
| --- | --- | --- |
| Serial adapter | Framing, bounded parsing, packet metadata, receive timestamps | Classification or cloud credentials in logs |
| Preprocessor | Channel selection, quality checks, normalization, window formation | Re-fitting normalization on live data |
| Model 1 runner | Artifact verification, tensor input/output, inference timing | Resident identity, language generation, family calls |
| Event logic | Threshold policy, temporal confirmation, cooldown, stable event IDs | Declaring medical certainty |
| Device transport | Health, authenticated reconnects, bounded outbox, acknowledgments | Incident authorization decisions |
| Backend | Device-room mapping, durable incidents, RBAC, deduplication, audit | Trusting device-supplied tenant identity |
| Model 2 adapter | Fact-constrained explanation with fallback | Incident suppression or notification authorization |
| Notification worker | Consent rechecks, approved dispatch, provider state | Inferring approval from model text |
| Dashboard | Monitoring, history, review and acknowledgment controls | Access enforcement solely in the browser |

## 4. Technical decisions and feasibility gates

The finalized architecture does not establish a software stack. The following
are proposals rather than claims of installed dependencies.

| Area | Proposed implementation | Gate before implementation |
| --- | --- | --- |
| Training | Google Colab with a small temporal neural network and exportable operations | Inspect dataset and select framework/export path |
| QNX edge | Small native service with serial adapter and compatible inference runtime | Prove USB access, model operations, threading, memory, and TLS/WSS on the actual QNX image |
| Model interchange | Versioned model artifact plus manifest; ONNX is a candidate | Verify exporter and QNX runtime support; no assumption of Linux package compatibility |
| Cloud | One service exposing REST/WSS with transactional SQL persistence and a notification worker | Select language/framework, database, hosting, and available SDKs |
| UI | Browser dashboard based on Paper designs | Verify intended Paper product, access, and handoff; select frontend stack |
| Model 2 | Hosted language-model API through a backend adapter | Select provider/model, credentials, data policy, limits, and timeout |
| Notifications | Photon adapter with explicit dispatch and status interfaces | Confirm exact Photon provider, supported call/notification API, consent requirements, and demo recipient |

**Critical path:** prove QNX serial input and a minimal neural-network forward pass
before investing in a larger model. Compile and run the actual required operators
on Pi/QNX; a desktop export alone is insufficient. If the chosen runtime fails,
choose a smaller compatible network or another QNX-compatible runner. Changing to
Linux, moving Model 1 to cloud, or replacing USB serial requires an explicit
architecture/specification decision and must not be presented as the required MVP.

## 5. Dataset organization and annotation semantics

**Required:** the dataset remains in its separate repository. Never clone it into
this application repository. Colab may clone it into its temporary runtime.
Application source may contain notebooks/scripts, inference code, interface
contracts, architecture documents, and lightweight configuration. Exclude raw
recordings, duplicate archives, temporary tensors, large checkpoints, and sensitive
resident information. Future ignore rules must cover generated data and secrets.

### Provisional recording layout

| Filename | Supplied description | Verification required |
| --- | --- | --- |
| `measurements.jsonl` | Raw CSI measurements and packet metadata | Keys, units, I/Q encoding, timestamp source, dimensions, and valid frame rules |
| `metadata.json` | Recording, participant, activity, collection configuration | Group identifiers, label vocabulary, collection hardware and consent/provenance |
| `events.json` | Optional fall annotations | Event shape, onset/end semantics, timestamp alignment, completeness |
| `raw_serial.bin` | Preserved serial output where available | Framing, encoding, and correspondence to parsed measurements |

These are reported filenames, not an observed dataset schema. Do not fabricate
example source records or silently map unknown keys. After access is restored,
record the exact dataset commit, inspect documentation and representative files,
and implement an explicit adapter to the internal contract.

### Required annotation rule and proposed labeling policy

Missing `events.json` can be intentional for a recording with no fall. Do not
require event files for all recordings and do not infer that every missing file
means normal activity.

| Recording category | Evidence needed | Training treatment |
| --- | --- | --- |
| Positive | An annotated fall with valid timing and alignment | Label eligible windows from verified fall intervals |
| Confirmed negative | Metadata or collection manifest explicitly establishes no fall | Eligible normal windows even without `events.json` |
| Unknown | Missing/ambiguous labels, incomplete positive annotations, or conflicting metadata | Quarantine from supervised training until reviewed |
| Invalid | Corrupt measurements, unusable timing, incompatible configuration | Exclude with an actionable reason |

Proposed: a window is positive when it contains an annotated fall onset and
satisfies configured minimum context before and after onset. Windows intersecting
falls without that context are excluded; windows outside fall intervals in a
positive recording are normal only if annotation completeness is verified and a
configured boundary margin is respected. Confirm these semantics against actual
annotation conventions before generating labels. Empty event files also need
metadata confirmation before being treated as negative.

Produce a dataset audit with recordings by category, durations, fall counts,
activity counts, missingness, sampling-rate distribution, dimensions, exclusions,
and available participant/session/room groups. Record class balance after windowing
and review label conflicts before training.

## 6. Model 1: training, preprocessing, and deployment

**Required:** train in Google Colab; deploy inference locally on Pi/QNX. No training
is performed by this documentation task.

### Proposed reproducible training sequence

1. Fetch the dataset in temporary Colab storage and pin its commit. Verify license,
   permission for use, and labeling audit before processing participant data.
2. Split by participant where available, otherwise by collection session or
   recording group, **before** fitting transforms or creating overlapping windows.
   Keep all windows from one recording in one partition. If groups are unavailable,
   document the limitation and avoid claims of participant generalization.
3. Establish train/validation/test manifests with deterministic seeds. Fit scalers,
   channel masks, and any learned transforms using training data only.
4. Start with amplitude derived from valid I/Q values and a small 1D temporal CNN
   yielding `p_fall`. A simple non-neural baseline may diagnose data quality but
   does not replace the required neural network.
5. Select temporal window, stride, supported channels, optimizer, class weighting,
   and thresholds on training/validation data. Record all selected values; do not
   invent a fixed CSI rate or subcarrier count before inspection.
6. Evaluate the frozen model and event policy on untouched test groups. Record
   event recall, missed falls, false alerts per normal-monitoring hour, precision,
   confusion matrix, class counts, and latency. Report denominators and grouping;
   never present window accuracy alone as fall-detection success.
7. Export the model and preprocessing manifest. Compare held-out tensors and
   outputs across Colab, exported runtime, and Pi/QNX within a declared tolerance.
8. Package the model, manifest, checksum, evaluation summary, and golden fixtures
   separately from large training artifacts. Store download/version instructions
   in the app repository when artifact hosting is chosen.

### Proposed preprocessing contract

A validated frame has recording/device identity, packet order or sequence when
available, device timestamp if supplied, monotonic receive time, complex CSI
values, and radio metadata needed to select a consistent channel layout.

The adapter derives amplitudes, applies the frozen channel mask, orders channels,
resamples to the manifest rate if needed, normalizes using training statistics,
and produces finite `float32` windows with canonical shape `[1, T, C]` (batch,
time, features). The runtime adapter may transpose only as declared in the
manifest. Model output is one finite `p_fall` in `[0, 1]`; it is a model score,
not validated certainty that a fall occurred.

Manifest fields must include schema/model version, dataset commit and split
manifest hash, artifact SHA-256, runtime/opset requirements, dtype/layout, feature
construction, channel mask/order, sampling rate, window and stride, normalization
statistics, maximum gap/interpolation policy, event thresholds, confirmation
count, cooldown, and export comparison tolerance. Values that are not yet measured
remain unset and block model release rather than receiving guessed defaults.

Training and inference must use identical preprocessing semantics. Validate
parity using small synthetic or approved de-identified golden fixtures. Unsupported
CSI layouts, serial corruption, long gaps, or incomplete windows invalidate the
window; they must not produce a normal score through zero filling. Reset buffers
after discontinuities and expose degraded health until a complete valid window
is available. Reject incompatible artifact/manifest combinations on startup.

### Proposed event policy

Confirm a candidate using a configurable count of consecutive windows above an
on-threshold; re-arm only after the score falls below a lower off-threshold for a
configured count and the cooldown expires. All parameters are selected on
validation data and versioned with the model. Emit one event per confirmed episode,
with onset/window times and a stable UUID. Continued movement must not create a
new alert every window. Inference remains independent of cloud availability.

## 7. Edge and cloud wire contracts

All schemas in this section are **proposed v1 interfaces**, not existing endpoints.
JSON uses UTC RFC 3339 timestamps with `Z`; IDs are opaque UUIDs unless stated.
All messages include `schema_version` and `type`. Validate types, ranges, finite
numbers, size, and authorized device mapping before accepting a message.

### Connection and delivery

- Proposed endpoint: `wss://<backend>/v1/device-stream`; provision a scoped,
  revocable device credential and send it in the handshake authorization header.
  Do not place secrets in query strings or disable certificate/hostname checks.
- Server maps the authenticated device to facility and room. A payload room ID is
  checked against this mapping and never grants access to another room.
- Proposed health cadence: 10 seconds; show offline after 30 seconds without
  accepted health, with serial/model faults shown independently of network health.
- Reconnect with full jitter and exponential backoff from 1 to 30 seconds. Reset
  after a stable session. Credential rejection requires reprovisioning, not a
  tight retry loop. Malformed records are rejected with bounded diagnostics.
- Proposed maximum message size: 16 KiB. Use ping/pong for connection liveness,
  explicit event acknowledgments for delivery, and no acknowledgment of heartbeats.
- Commit an event to a bounded local outbox before send; remove only on durable
  backend acknowledgment. Proposed bounds: 1,000 events and 24 hours, whichever
  comes first. Surface expirations/overflow as data loss and degraded health.
  Never silently report successful delivery. Verify QNX persistent storage support;
  an in-memory-only fallback must disclose loss on restart.
- Backend transaction inserts the unique `(device_id, event_id)` and incident
  before acknowledgment. A lost acknowledgment triggers retry of the same event;
  duplicates return the same incident and do not rerun notifications. Reject reuse
  of an ID with a different payload. Out-of-order delivery preserves observation
  and receipt times. Delayed incidents require fresh staff review before dispatch.

### Inference event example

```json
{
  "schema_version": 1,
  "type": "inference_event",
  "event_id": "668aad49-df00-447d-9196-ab970f87df54",
  "device_id": "pi-room-01",
  "boot_id": "cf511373-e199-4f61-bd40-0c54f94fdc91",
  "sequence": 42,
  "room_id": "room-01",
  "observed_at": "2026-10-17T19:00:00Z",
  "window_start": "2026-10-17T18:59:58Z",
  "window_end": "2026-10-17T19:00:00Z",
  "event_kind": "possible_fall",
  "p_fall": 0.91,
  "model_version": "demo-v1",
  "preprocessing_version": "demo-v1",
  "policy_version": "demo-v1",
  "data_quality": "valid",
  "clock_synced": true
}
```

Times and score are illustrative, not a selected window length, measured result,
or threshold. Require `window_start < window_end`, observation time within the
window, nonnegative sequence, recognized versions, and `data_quality = valid`.
Use monotonic clocks for buffering and latency; retain wall-clock sync status.
Unsynced observations retain device timing but the backend marks time uncertainty
and uses receipt time for ordering rather than fabricating a precise occurrence.

Durable acknowledgment example:

```json
{"schema_version":1,"type":"event_ack","event_id":"668aad49-df00-447d-9196-ab970f87df54","incident_id":"b749ad00-fca5-470d-9a42-620d18e98d6c","status":"accepted"}
```

A duplicate acknowledgment has `status: "duplicate"`. Error messages use
`type: "error"`, an optional `event_id`, stable error code, and `retryable` flag;
proposed codes are `invalid_payload`, `unsupported_version`, `unauthorized_device`,
`id_conflict`, and `temporarily_unavailable`. Retry only transient failures.

### Health payload

Required proposed fields: `schema_version`, `type: "device_health"`, `device_id`,
`boot_id`, `sent_at`, `uptime_seconds`, `serial_status` (`ok|disconnected|error`),
`model_status` (`ready|loading|error`), `last_valid_frame_at` (nullable),
`invalid_frame_count`, `outbox_depth`, `dropped_event_count`, and `clock_synced`.
Backend adds `received_at`; UI derives online/degraded/offline with explicit reason.
An online socket does not mean sensing is working. Avoid rendering “no fall” when
serial, windows, or inference are unavailable.

## 8. Backend data, REST, and incident lifecycle

### Proposed persisted entities

| Entity | Minimum fields/invariants |
| --- | --- |
| Facility, Room | IDs, facility membership, display name; no identity inferred from radio |
| Device | ID, assigned room/facility, credential reference, versions, last health |
| User and membership | Auth subject, facility/room scope, role; server-enforced |
| InferenceEvent | Unique device/event key, validated payload/hash, observed/received timestamps, linked incident |
| Incident | UUID, room, event reference, status, version, created/acknowledged/resolved times and actor references |
| Explanation | Incident, generation status, text, structured-input hash, model/prompt version, fallback reason |
| FamilyContact and consent | Authorized room relationship, private destination, consent scope/status/time and revocation |
| Notification | Incident/contact, reviewer, approved content, idempotency key, provider ID, status and timestamps |
| AuditEntry | Actor, scoped action, target, time, outcome; no tokens or full contact destination |

Use transactions and unique constraints for deduplication and state transitions.
Do not invent a resident identity from the MVP's one-person assumption.

### Proposed endpoints

| Method/path | Behavior |
| --- | --- |
| `GET /v1/rooms` | Authorized rooms, health and last observation/receipt times |
| `GET /v1/incidents?room_id=&cursor=&limit=` | Scoped history; proposed default 25, maximum 100; stable cursor ordering |
| `GET /v1/incidents/{id}` | Facts, explanation status, lifecycle and permitted notification history |
| `POST /v1/incidents/{id}/acknowledge` | Staff acknowledgment with expected incident version |
| `POST /v1/incidents/{id}/resolve` | Staff resolution with disposition and optional bounded note |
| `POST /v1/incidents/{id}/notifications` | Staff-reviewed dispatch referencing contact, approved content and consent |
| `GET /v1/stream` (WebSocket upgrade) | Authenticated room/incident/health/notification updates in the user's scope |

Mutations require authentication, scope, role, optimistic version checks, audit,
and an idempotency key. Use `400` validation, `401` unauthenticated, `403` denied,
`404` absent or concealed cross-scope object, `409` state/version conflict, `429`
rate limit, and `503` transient unavailability. Standard error body:
`{"error":{"code":"state_conflict","message":"Incident changed; refresh before retrying.","request_id":"opaque-id"}}`.

Live updates follow database commit and carry an update ID, type, object ID, and
version. Proposed MVP reconnect behavior is to refetch authorized REST snapshots
and history; do not promise durable live-message replay. Ignore older versions in
the browser. A disconnected dashboard must display stale state until refreshed.

### Lifecycle

`open -> acknowledged -> resolved`. Acknowledgment means a staff member has seen
the incident; it neither confirms a fall nor approves a family call. Resolution
records `confirmed_fall`, `false_alarm`, or `unknown` as staff disposition without
claiming a clinical conclusion. Staff may resolve an open incident while recording
who performed that action. Resolved incidents are read-only for MVP; a later fall
creates a new incident. Concurrent actions return a conflict or an idempotent result.

Notification status is separate: `pending_review -> queued -> sending -> sent`,
with `cancelled`, `failed`, and `unknown` as alternative outcomes. `sent` means
provider acceptance unless a verified callback establishes delivery; answered or
read status must not be inferred.

## 9. Model 2: incident explanations

**Required:** Model 2 receives structured facts rather than CSI. It does not detect
falls, override Model 1, establish consent, or authorize calls.

Proposed input: incident ID, room display label, observed/received time and clock
quality, event kind, model score labeled as a score, model version, data quality,
device health, and staff-confirmed facts when available. Exclude phone numbers,
resident names, raw CSI, credentials, and unsupported medical information.

Proposed output contract: JSON containing `summary` and `limitations`, each bounded
by configured length; backend validates schema and rejects unsupported claims.
Prompt instructions require cautious plain language, only supplied facts, no
injury/diagnosis assertion, no invented response history, and no emergency advice
that suggests the system has contacted services. Treat staff notes as data and
never as instructions.

Generate asynchronously after persisting the incident. Proposed timeout: 5 seconds,
one retry for transient errors, then deterministic text such as “Possible fall
flagged in Room 01. Staff review is needed; the system cannot confirm injury.”
The UI must display the incident immediately with `pending`, `ready`, or `fallback`
explanation status. Store model/prompt version and input hash for reproducibility.
A provider outage must not delay incident ingestion, acknowledgment, or review.

## 10. Access, privacy, and Photon notification workflow

### Proposed access model

| Principal | Allowed scope/actions |
| --- | --- |
| Device | Submit its own inference and health; receive its acknowledgments |
| Caregiver | Assigned rooms, incident review/acknowledgment/resolution and approved notification dispatch |
| Operator/admin | Facility room/device configuration, staff scope, contact/consent management and audit review |
| Authorized family | Receive approved information for their authorized contact relationship; portal access is stretch |

Backend enforces every object access and stream subscription. Use established
user authentication, secure session handling, and CSRF protection where cookie
sessions authorize mutations. Keep secrets in deployment secret storage, use TLS,
mask logs, and restrict database access. CSI is privacy-sensitive movement data;
absence of cameras does not make recordings anonymous.

### Required review flow, proposed implementation

1. Persist a possible-fall incident and show it to authorized staff.
2. Staff reviews facts, explanation, recipient, consent, and the exact proposed
   notification/call script. LLM output alone cannot supply approval.
3. Backend verifies staff scope, current incident state/version, active contact
   authorization and consent, and approved content. Reject dispatch after incident
   resolution; a stale review requires refresh.
4. Atomically store the approval and durable notification job, using a unique
   idempotency key for the dispatch. Recheck consent and incident state immediately
   before provider submission; cancel unsent jobs if consent was revoked or incident
   resolved. Any content/recipient change requires new review.
5. Photon adapter submits the approved payload with server-side credentials. Store
   provider ID and distinguish accepted, delivered, failed, and unknown outcomes.
6. Verify webhook signatures and deduplicate callbacks if the selected provider
   supports callbacks. Never assume that feature exists before verifying its API.
7. Retry transient failures only when safe using provider idempotency or a status
   lookup. An ambiguous call submission becomes `unknown` for reconciliation and
   staff attention; do not blindly retry a call that may already have happened.

A consented team-owned test number is the demo recipient. No automatic emergency
service call is in scope. If Photon access is unavailable, a labeled mock may
exercise workflow development but does not satisfy the required live integration.
Record exact provider identity, API documentation, credential owner, supported
idempotency/status mechanisms, and a successful authorized test before claiming
integration completion.

### Proposed data handling

Use staged, consented recordings and synthetic dashboard identities for the demo.
Keep raw CSI in the separate dataset workflow or local capture storage; do not
upload it to the incident backend. Proposed demo backend retention is seven days
for events, incidents, explanations, notifications, and audits, followed by deletion
including derived copies; document backup expiry for the chosen host. This is a
proposed demo default, not a legal or clinical retention policy. Dataset retention,
participant permissions, and Model 2 provider retention require explicit verification.
Avoid production resident data until these policies and access controls are agreed.

## 11. Caregiver UI and Paper integration

**Required views:** room monitoring, incident history, incident detail, and staff
acknowledgments. Proposed detail actions include resolution and reviewed family
notification. Room cards show sensing health, last update time, and unresolved
incident count. Detail shows “possible fall,” observation/receipt times, data
quality, explanation status, staff activity, and notification state.

Include loading, empty, error, stale/offline, degraded sensing, explanation fallback,
consent missing/revoked, dispatch failure, and concurrent-edit states. Show text
and icons in addition to color, accessible focus order, and clear confirmation of
recipient and script before dispatch. Retain the incident in history after resolution.

Paper is the requested UI/design integration, but no Paper document, generated
code, or SDK exists in this repository. Confirm the tool and artifact link, create
a small design for these flows, then implement against the backend contracts.
Do not claim Paper runtime integration or a required API without evidence.

## 12. Ownership and implementation order

No individual assignments were supplied or found. Role ownership below is proposed;
the team must name an accountable person for each before parallel implementation.
One person may own multiple roles. Interface changes require agreement from both
sides of the boundary.

| Role (assignee unassigned) | Deliverables and handoff |
| --- | --- |
| Hardware/QNX owner | Verified firmware/serial settings, packet fixtures, QNX setup, serial and inference feasibility evidence |
| ML/data owner | Dataset audit, label adapter, split manifests, Colab training, exported model/manifest and evaluation |
| Backend owner | WSS ingestion, persistence, REST/live contracts, auth/RBAC, explanation and notification orchestration |
| Frontend/Paper owner | Paper artifact, dashboard views and all review/error states wired to scoped APIs |
| Integration/demo owner | Photon credentials/provider confirmation, authorized demo recipient, end-to-end evidence and runbook |

### Milestones in dependency order

| Priority | Slice | Exit evidence |
| --- | --- | --- |
| P0 | Resolve dataset access, missing request tail, named owners, and stack/provider decisions | Dataset/schema notes, decision log, interface owners; no fabricated findings |
| P0 | Hardware feasibility on Pi/QNX | Real serial frames, sustained parsing, compatible tiny model forward pass and working TLS/WSS client |
| P0 | Vertical transport slice | Clearly labeled synthetic event → authenticated WSS → durable incident → dashboard, duplicate/reconnect verified |
| P0 | Train/export Model 1 in Colab | Grouped split, frozen preprocessing and event policy, held-out report and QNX output parity |
| P0 | Connect live sensing | USB CSI → windows → local model/event policy → cloud incident with correct health and timing |
| P0 | Model 2 and caregiver actions | Fact-constrained explanation/fallback, acknowledgment/resolution, audited access |
| P0 | Photon reviewed notification | Consent and review gates, single authorized live dispatch and visible provider outcome |
| P0 | Rehearse complete demo | Staged fall, normal movement, offline/reconnect and fallback cases, limitations disclosed |
| P1 | Improve robustness and presentation | Longer evaluation, latency/size tuning, polished Paper design, improved monitoring |
| P2 | Stretch scope | Additional rooms/channels or analytics after all P0 criteria pass |

Cloud/UI work can use synthetic contract fixtures while hardware/ML feasibility is
being resolved. Mock, replayed, and live inputs must be visibly distinguished.
Neither a replay demo nor a cloud-only model proves live Pi/QNX sensing.

## 13. Validation and MVP acceptance

No test, build, or training commands exist at the baseline. Each future component
must add reproducible setup/check commands with its implementation. The cases below
are planned acceptance checks, not tests already executed.

| Area | Required evidence before claiming MVP completion |
| --- | --- |
| USB/QNX | Receiver output parsed on actual Pi/QNX; actual baud/driver/framing documented; unplug/replug and malformed frames handled |
| Model/data | Verified source schema, explicit negative/unknown handling, no split leakage, reproducible training and artifact/preprocessing parity |
| Sensing | Controlled staged fall and normal activity demonstrated; data loss produces degraded status, not fabricated normal inference |
| Event policy | Repeated high windows produce one episode; re-arm permits a later episode; invalid windows do not trigger inference |
| WSS | Valid device accepted; unauthorized/misassigned device rejected; reconnect, lost ACK, duplicate and conflict behavior verified |
| Persistence/UI | One durable incident per event; history survives backend restart; health ages offline; UI refetches after reconnect |
| Access | Cross-facility REST/stream access denied; family cannot invoke staff actions; concurrent lifecycle changes handled |
| Model 2 | Structured facts only; pending incident remains visible; timeout/malformed output yields safe fallback without lost incident |
| Photon | Authorized consented recipient, staff approval, revoked consent rejection, duplicate suppression and ambiguous-send handling verified |
| Demo | Live end-to-end Pi/QNX inference → incident → explanation → staff review → one Photon notification, with no clinical claim |

Proposed engineering target: healthy-network incident visibility within five seconds
of edge event emission, excluding the collection window and asynchronous explanation.
Measure stage timings, p50/p95 latency, and hardware inference runtime/memory. The
team must agree detection-quality targets after dataset audit; no unsupported
accuracy, recall, or false-alarm guarantee is established here. Report missed falls
and false alerts honestly, including a small or unrepresentative test population.

Required failure scenarios include serial loss, invalid model, backend outage,
restart with unacknowledged events, stale UI, LLM outage, Photon outage, unauthorized
access, duplicate callbacks, and consent revocation before dispatch. Record which
were exercised on actual hardware versus fixtures and identify remaining limits.

## 14. Risks and decisions still required

| Unresolved item | Owner role | Decision/evidence needed |
| --- | --- | --- |
| Truncated request | Integration/demo | Obtain remaining source requirements and reconcile this spec |
| Dataset unavailable | ML/data | Restore read access; pin commit; inspect files, label semantics, permissions, groups and sample rate |
| ESP32 compatibility | Hardware/QNX | Models/firmware, radio configuration, CSI layout, USB framing/baud and known-good capture |
| QNX feasibility | Hardware/QNX | Exact image/BSP, USB driver, compiler/ABI, inference runtime/operators, WSS/TLS and persistent outbox support |
| Model/training choices | ML/data | Framework, network, manifest values, metrics, thresholds and artifact distribution |
| Cloud/UI stack | Backend + frontend | Language, database, auth, host, secret storage, deployment and run commands |
| Paper identity/access | Frontend/Paper | Exact product, design artifact and code handoff |
| Photon identity/access | Integration/demo | Exact provider/API, credentials, consent model, delivery states and idempotency behavior |
| Explanation service | Backend | Model/provider, prompt, privacy policy, cost/rate limits and fallback validation |
| Team assignments | Integration/demo | Named accountable owners, availability and handoff deadlines |
| Demo policies | Integration/demo | Consent, retention, deletion, quality targets and recorded limitations |

This task creates documentation only. No features, notebooks, datasets, training
runs, models, external notifications, or deployments are created by this change.
