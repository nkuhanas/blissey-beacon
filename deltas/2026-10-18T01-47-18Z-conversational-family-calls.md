# Blissey Beacon — ElevenLabs + Photon conversational family calls

- Recorded: 2026-10-18T01:47:18Z (2026-10-17 in the project timezone).
- Status: Approved specification change; implementation and provider integration pending.
- Approval: user requested “fold in this delta,” then clarified the success criterion:
  a connected call in which our side says the incident counts; no recipient
  acknowledgment is necessary, including when the recipient hangs up to act.
- Baseline: `main` at `6d5879edffcfc68a0dc4d0e02763bf6018bafc27`.
- Canonical specification: [PROJECT_SPEC.md](../PROJECT_SPEC.md); entrypoint: [SPEC.md](../SPEC.md).
- Decision: ADR-028, the next available identifier after ADR-027.

## Previous and revised requirements

| Affected sections | Previous requirement/assumption | Approved revision and rationale |
| --- | --- | --- |
| §1–2 Summary/scope | Reviewed static Photon notification | Operator-authorized bounded family conversation through ElevenLabs and Photon; preserve single-room sensing scope |
| §4–6 Architecture/network/stack | Railway dispatches directly through unspecified Photon calling/messaging API | Railway authorizes and orchestrates ElevenLabs Agents with planned Photon outbound SIP; signed provider evidence returns to the same backend; no additional voice service |
| §17 Gemini | Operator explanation and general family-content restriction | Keep existing worker/output; derive a separate family-safe projection, since current operator prose includes prohibited experimental scores |
| §18 Data/persistence | Preconfigured family contact; exact text approval and generic provider status | Patient-linked primary consented contact, historical room assignment, immutable call authorization/context/opening/policy, durable call job/attempt/events and minimal provider evidence |
| §19 Dashboard | Incident actions and notification approval | Paper-designed contact/consent configuration, review/authorize call and show status/spoken evidence with optional callback request |
| §20 Contact configuration | Arbitrary destination entry prohibited | Authorized operators may save consented E.164 patient contacts; no arbitrary destination input at dispatch; one primary contact per fictional resident |
| §20 Call authorization | Approve exact recipient and final notification text | Approve/freeze recipient, family-safe factual context, opening and bounded conversation policy; later changes cannot silently add claims |
| §20 Call delivery | Generic `accepted`/`delivered` lifecycle | Separate queued/initiating/in-progress/completed/failed/unknown transport from connected and notification-spoken evidence; no mandatory conversation-outcome enum |
| §20 Success clarification | Supplied proposal required structured conversation outcomes and recipient acknowledgment | Success means connected plus provider evidence our agent spoke the incident notification; no acknowledgment, complete dialogue or subsequent family action required; a hang-up afterward does not invalidate success |
| §21–22 Ownership/sponsors | Photon integration lead TBD; no ElevenLabs role | Provider lead remains TBD and owns agent/LLM, Photon SIP and evidence mapping; separate real-use evidence and eligibility for each sponsor |
| §23 API | Existing planned notification POST | Retain POST; add planned contact GET/PUT, call-history GET and signed ElevenLabs webhook; schemas and exact creation/preview semantics must be settled before implementation |
| §24 Security/privacy | Exact-text approval, private contacts and consent | Recipient check before disclosure, bounded agent with no live database/mutation tools, signed/replay-safe callbacks, minimal retained voice data, provider retention verification |
| §25–27 Acceptance/tests/risks | Real approved Photon contact, idempotency and delivery | Real consented ElevenLabs/Photon connected call plus notification-spoken evidence; follow-up/uncertainty/callback capability tests, after-message hang-up success, before-message disconnect uncertainty, wrong-recipient/voicemail nondisclosure and recovery |
| §28–30 Roadmap/status/open decisions | Generic Photon integration later; APIs unimplemented | Add call-specific milestones and explicit unresolved provider/DTO/evidence/retention decisions; preserve current implementation and rollout evidence |
| §31–32 Decisions/maintenance | ADRs through ADR-027 | Add ADR-028 and this approved timestamped delta; preserve historical rationale |

## Approved flow

Persisted incident → validated Gemini explanation → backend family-safe projection
→ operator reviews recipient/context/opening/policy → durable authorization and job
→ ElevenLabs conversational agent → Photon SIP → consented family recipient
→ signed provider evidence → Supabase → authorized dashboard.

The conversational model communicates approved facts; it does not reinterpret CSI.
Persisted sensor facts remain authoritative. It may state known facts, explicitly
communicate uncertainty and capture a callback request. It cannot diagnose,
reclassify events, invent activity/position/staff responses, escalate emergencies,
mutate incidents, query live databases or initiate additional notifications.

## Preserved contracts and limits

- The seven-field v2 event remains `event_type: "inference_result"` with the same
  `confidence_scores` object. Model 1, authenticated WSS, durable ACK/deduplication,
  health, transactional persistence, Supabase Auth/RLS and incident lifecycle remain unchanged.
- The four-field Gemini explanation contract and existing worker remain unchanged.
  The new context is a separate notification contract; no inference rerun is needed.
- The supplied example's `possible_fall` discriminator/summary is not adopted as an
  automatic interpretation. The context example uses `inference_result` and a neutral
  sensor-result summary. More specific wording requires supported facts and review.
- No scores/CSI, unnecessary personal data or unsupported condition/staff assertions
  go to the voice agent. A fallback must not claim Gemini provenance.
- Use fictional residents, consented real test recipients and one primary contact
  per resident. Preserve historical patient association at detection time.
- Default to one authorized outbound call per incident/contact. Repeated requests do
  not place new calls; an explicit retry requires renewed operator authorization.
- Persist attempts before external dispatch. Ambiguous submission requires
  reconciliation or unknown status; leases alone do not guarantee exactly-once calls.

## Success criterion after user clarification

Record transport independently from notification evidence. Success requires both:

1. Evidence that the call connected to the verified intended recipient.
2. Provider evidence that our agent spoke the approved incident notification.

Do not demand an acknowledgment, a completed dialogue or proof that the family
understood or acted. A recipient hanging up after hearing the incident is a valid
success. A connection alone, provider acceptance or generated/planned text is not
proof the notification was spoken. A disconnect beforehand leaves success unproven.

The supplied proposal's seven-value conversation-outcome enum is not mandatory.
Optional callback requests and reliable no-answer/voicemail/wrong-recipient metadata
may be retained; do not infer intent or an outcome from a hang-up alone. Exercise
ordinary follow-up, uncertainty refusal and callback capture as capability tests,
not compulsory recipient behavior on every successful call.

## Superseded assumptions

- Approval of exact static text is replaced by approval of a frozen bounded session,
  including an opening message. Later claims require new review rather than live enrichment.
- Contact configuration may accept a private consented number; dispatch may not accept
  arbitrary numbers. A changed destination invalidates unsent authorization.
- Generic accepted/delivered labels are replaced for voice by transport plus evidence
  of connected/spoken notification; provider acceptance alone is insufficient.
- No mandatory acknowledgment classifier or full conversation-outcome subsystem.

## Remaining decisions and verification

The exact Photon product, SIP trunk/number configuration, ElevenLabs agent/voice and
conversational LLM remain unverified. Gemini Flash is a preferred voice-model
candidate, not a confirmed supported configuration. Establish recipient-check wording,
family-safe JSON Schemas/DTOs, contact PUT creation rules, review-snapshot mechanism,
provider idempotency/reconciliation, signature replay handling and mapping of provider
evidence to connected/notification-spoken fields before implementation/live acceptance.

The relevant documented interfaces are the ElevenLabs
[outbound SIP API](https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call)
and [post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).
Their existence is not evidence of a tested Photon–ElevenLabs integration or that a
specific callback proves playback. Verify actual provider evidence before declaring
notification success. Full audio/transcript retention is unnecessary for the MVP;
provider-side retention, consent and deletion settings still need verification.

Planned Railway-only variables are `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`,
`ELEVENLABS_PHONE_NUMBER_ID` and `ELEVENLABS_WEBHOOK_SECRET`. Photon SIP credentials
normally belong in the trunk configuration; any backend Photon credentials depend
on the eventual setup. Examples are placeholders, not consumed runtime config.

## Scope and implementation status

This change updates documentation and configuration examples only. It creates no
application code, migration, dependency, runtime schema or provider configuration,
and makes no call. Family contacts, incident actions, notification jobs/calls,
ElevenLabs and Photon remain unimplemented. Gemini's existing real-model/local
PostgreSQL/Realtime verification and pending hosted-worker rollout are unchanged.
No sponsor eligibility, live telephony or completed full-system acceptance is claimed.
