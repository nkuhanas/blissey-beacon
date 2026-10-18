# Family iMessage follow-ups

ADR-029 extends approved family calls with independently consented Photon 2.0
hosted iMessage. The sensing/Gemini contracts are unchanged. No Mac relay or new
inference model is used. Source, migrations and synthetic tests exist; hosted
rollout and live reply reception remain unverified. The initial Python check hit Cloudflare error 1010, not a demonstrated key-permission
problem. The actual Node adapter authenticated successfully on 2026-10-18 UTC;
the active recipient assignment and initial inbound onboarding were verified.
The local sender value was corrected to the assigned Photon line. One clearly labeled
synthetic update passed the actual authorization/worker path using an isolated Docker
PostgreSQL database and real Photon. Its provider state advanced from accepted to
delivered. A family reply has not yet been observed; hosted rollout remains pending.

## Configuration and rollout

Keep these in ignored `.env.deploy.local` for administration, and Railway's
server-side environment for runtime. Never use VITE_ names or commit populated files.

```dotenv
PHOTON_PROJECT_ID=pho_prj_YOUR_PROJECT
PHOTON_API_KEY=YOUR_PROJECT_KEY
PHOTON_IMESSAGE_SENDER_NUMBER=+1XXXXXXXXXX
NOTIFICATION_MESSAGES_ENABLED=false
```

`PHOTON_IMESSAGE_SENDER_NUMBER` is the Photon **sending** number, not the family
recipient. `DEMO_FAMILY_PHONE_E164` remains the local smoke recipient allowlist;
the backend dispatches only to the saved contact. The iMessage sender may differ
from `PHOTON_CALLER_NUMBER`; SIP credentials do not authenticate messaging.

The key needs the project permissions required by platform/assignment reads, user
and space create-or-get operations and message reads/sends. The existing key has
full access; do not rotate it merely because a different HTTP client hits Cloudflare. The official Photon 2.0
[OpenAPI](https://github.com/photon-hq/api/blob/main/openapi/openapi.json) is the
adapter authority; legacy Advanced iMessage Kit credentials/endpoints are separate.

For a shared line, assign this exact recipient to the configured sender in Photon
and have the recipient send an initial iMessage to that line **after assignment**.
A different contact may need a different sender. No automatic assignment purchase,
invitation, SMS fallback or line provisioning occurs in this implementation.

```sh
sh scripts/imessage-check.sh
```

This verifies assignment/onboarding and resolves users/a DM using create-or-get
operations. It sends nothing and prints no phone numbers, tokens or message bodies.
A dedicated line is checked for active iMessage capability; shared onboarding is
not applicable there. Limits and actual provisioning still require provider evidence.

1. Run `sh scripts/verify.sh --realtime` against disposable Docker infrastructure.
2. Back up hosted schema/data; apply only the unapplied migration
   `20261018043000_family_messages.sql` after the four existing migrations.
   This adds separate messaging consent defaulting to **revoked** and private tables.
3. Deploy the backend with messaging **false** and verify existing voice/ingestion APIs.
4. Explicitly grant the existing consented test contact's messaging consent through
   the scoped API; do not infer it from voice consent or migrate contacts to granted.
5. Verify Photon routing with the script. Enable messaging only on the dedicated
   demo backend when ready for an explicitly reviewed live rehearsal. Voice and
   messaging flags are independent. Enabling a worker can process existing approved
   jobs; inspect them first and disable/restore the flag after the rehearsal.
6. Test one no-answer/busy generic follow-up and one operator-reviewed summary,
   then reply ACK/CALLBACK and verify REST plus incident Realtime invalidation.
   Record IDs/status/evidence privately, without storing full call audio/transcripts.

The current hosted database was approved for fictional demo setup, but this document
is not evidence that this new migration or rollout has been performed.

## Operator APIs and atomic approval

All endpoints require a Supabase operator JWT and facility membership. Private
contacts, texts and provider credentials are never directly selectable or published
through Supabase Realtime. Requests use JSON Schema contracts in packages/contracts.

| Endpoint | Purpose |
| --- | --- |
| PUT `/api/operator/family-contacts/:id/messaging-consent` | Separate grant/revocation with expected contact revision and explicit confirmation |
| POST `/api/operator/incidents/:id/messages/preview` | Verify recipient route; freeze follow-up candidates or an exact staff-verified update |
| POST `/api/operator/incidents/:id/notifications` | Existing call approval, optionally with explicit messaging approval below |
| POST `/api/operator/incidents/:id/messages` | Authorize a reviewed staff update; requires Idempotency-Key |
| POST `/api/operator/message-authorizations/:id/review` | Explicit classification/authorization for a finished call whose evidence is uncertain |
| GET `/api/operator/incidents/:id/messages` | Message plans, delivery history and correlated replies |
| GET `/api/operator/family-replies?facility_id=...` | Facility reply inbox, including ambiguous/unassigned replies |
| PATCH `/api/operator/family-replies/:id` | Operator reviews intent and, if ambiguous, selects a valid original incident |

For joint approval:

1. Grant messaging consent using `expected_revision`, `consent_status` and
   `consent_confirmed: true`. This increments contact revision and invalidates
   previously queued contact approvals; prepare both previews afterward.
2. Obtain the existing call preview and a message preview with `contact_id`,
   `expected_revision`, `purpose: "followup"`. Both use the same incident revision.
3. Review recipient, sender, both exact message candidates and the call policy.
4. Submit the usual call authorization plus `message_preview_id`,
   `message_context_hash`, `explicit_messaging_authorization: true`.
   The call and waiting message plan commit atomically, or neither does.
   The backend messaging flag must be enabled; existing call-only clients still work.
   An identical call request returns its existing call/plan rather than authorizing
   or placing another call/message.

For a staff update, preview `purpose: "update"`, `update_text` and
`verified_facts_confirmed: true`, review the exact resulting text, then submit its
preview/hash/revision with `explicit_authorization: true` and an Idempotency-Key
to the messages endpoint. This is human-authored, verified content; no new Gemini
call or autonomous medical advice is involved.

The existing demo call CLI remains call-only. It does not silently opt contacts
into messages or authorize follow-ups. Use the reviewed API flow above for this slice.

## Selection and evidence

| Evidence | Selection |
| --- | --- |
| Confirmed no-answer, busy, voicemail or ended before communication | Generic missed-call message; no resident/room/incident details |
| Incident communicated to verified intended recipient | Approved summary, even if the recipient subsequently hangs up |
| Unknown, incomplete or conflicting evidence | Operator review; no automatic message |

The signed ElevenLabs failure callback's `busy`/`no-answer` reasons are mapped
using the [official callback contract](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks).
Voicemail is a connected call, not a call-initiation failure. Automated voicemail,
recipient-verification and playback-completion mappings remain unverified. A
completed session, transcript or model-analysis result never automatically selects
a summary. Those cases currently enter review. The operator review request requires
an observed evidence category, `recipient_verified`, a bounded evidence note,
expected incident revision and explicit authorization. It does not rewrite the
underlying provider's connected/spoken evidence or claim clinical certainty.

Exactly one initial message is selected per call plan. Authorization freezes text,
route and consent revision. Dispatch rechecks membership, historical patient,
consent, snapshot integrity, age (24-hour maximum) and the current Photon assignment.
It commits a unique attempt before submission, using `blissey-message-<message UUID>`
as the Photon idempotency key. Lost responses/restarts become unknown and are never
blindly resent. If a provider ID exists, read-side reconciliation can recover its
state. An unknown send with no provider ID requires manual provider reconciliation;
creating a replacement authorization to evade that uncertainty is unsafe.

## Replies and frontend handoff

The same Railway worker polls the authorized conversation's received messages.
Shared line identities omit a resource ID, so their DM reads use the documented
`perspectiveUserId` interface; client-side timestamp filtering applies because
that interface forbids time/platform query filters. Dedicated lines use their
resource ID. DM creation has a stable idempotency key. A durable leased page cursor resumes after restart. Completed scans restart from
the original authorization time, so eventually consistent late arrivals are not
lost behind a moving timestamp. Database provider-message uniqueness deduplicates
repeated scans. This deliberately favors correctness for a small demo; history
retention, archival and higher-volume ingestion remain future operational work.

Explicit parent-message correlation identifies the original incident. Otherwise,
only one unique known incident in that sender/recipient conversation is accepted.
Multiple incidents remain unassigned in the facility inbox for operator selection.
Outbound echoes and different sender/recipient conversations are ignored. Text is
bounded to 4,000 characters and treated as untrusted content, never instructions.

ACK/ACKNOWLEDGED/RECEIVED label acknowledgment; CALLBACK/CALL ME/PLEASE CALL ME/
REQUEST CALLBACK label a callback request. Other prose, including “Could someone
call me with an update?”, is preserved as `operator_review` so staff can identify
intent without an inference model or unreliable negation matching. Operators can
explicitly label it `callback_requested`. STOP/UNSUBSCRIBE/CANCEL/END/QUIT revoke
messaging consent and cancel unsent work. No automated reply promises staff action.

`MessageHistory` and `FamilyReply` are shared generated contracts. Frontend helpers
live in `apps/web/src/messages.ts`. Incident revision changes invalidate REST state
using the existing scoped Realtime subscription. Fetch on initial load/reconnect;
poll the facility inbox for unassigned items. Render bodies through React text
nodes only. Show “callback requested — pending operator review”; delivery/read
status never means recipient action or resident safety. Preserve stale/error states.

The supplied [Paper file](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0)
was recorded, but Paper work was stopped at the user's request. Frontend view
integration remains pending;
this change provides data helpers and APIs, not a completed dashboard view. No live
send/receive or prize eligibility is established by the synthetic test suite.

Read receipts are not mapped from the current Photon 2.0 delivered-message status;
`delivered` does not imply `read`. The DTO reserves a read state for future verified
receipt handling. Do not claim a read receipt from delivery or from a family reply.

## Live iMessage smoke — 2026-10-18 UTC

One real iMessage was sent to the previously registered consented test phone.
The exact text identified itself as a synthetic smoke test, stated that no real
incident occurred, and requested ACK/CALLBACK/STOP responses. No call was placed.

The actual backend store, transactional authorization, unique attempt, Photon adapter,
read-side status reconciliation and authorized history route were exercised against
a fresh disposable Docker PostgreSQL database. Incident, operator identity and
Gemini response were explicitly synthetic. Photon accepted the message, then reported
`delivered`. This is evidence of live Photon sending/delivery, not a hosted Supabase,
Railway or frontend rollout and not real Gemini/voice or hardware evidence.

The private journal is `.supabase-test/imessage-live-journal.json`; it is ignored by
Git and Docker builds. No production application schema, data or dispatch flag was
changed. No automatic resend was made. Reply reception/correlation still requires
actual incoming evidence; synthetic tests alone do not establish it.
