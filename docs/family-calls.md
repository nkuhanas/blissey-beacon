# Family-call backend and frontend handoff

This slice implements the backend contact/review/authorization path, incident
workflow actions, a durable single-attempt dispatcher and signed callback intake.
It keeps the existing v2 inference-event and four-field Gemini explanation schemas.
Automated call-provider tests use synthetic numbers/responses. One separately
consented live ElevenLabs/Photon smoke reached the test recipient; see the dated
record below for conversation issues and the remaining playback-evidence limit.

## Dispatch stays off

`NOTIFICATION_CALLS_ENABLED=false` is the default. Saving credentials does not enable
calling. With calling disabled, operators can save contacts, review previews and
read history, but new call authorization returns `503 calls_not_configured`.
Only enable the flag after verifying the actual agent, Photon SIP trunk/number,
recipient verification and provider event mapping. All four ElevenLabs variables
must be present when the flag is true. No second backend service is needed.

The user's consented real test destination is held only in ignored local deployment
configuration. It is not a seed, fixture, source default or browser build variable.
The family-call migration was subsequently applied to the approved hosted demo
after a private schema/data snapshot. The merged backend is deployed with dispatch
disabled; contact configuration and review previews were verified without authorizing
a call. Frontend controls remain pending.

## Shared contracts and API sequence

JSON Schemas in `packages/contracts/schemas` define contact input/output, call
context, preview request/response, authorization, call read DTO and incident actions.
Generated TypeScript types and Ajv validation use those same definitions. Existing
strict incident DTOs retain their response shape and empty `allowed_actions` for
compatibility. The workflow endpoint supplies actual actions separately.

Every operator request requires a Supabase JWT and facility membership. The
following additions are implemented in the backend source:

1. `GET /api/operator/incidents/:id/workflow` returns current status/revision,
   disposition, permitted next lifecycle state/add-note action, notes and the
   historically assigned patient ID. Ambiguous/missing historical assignment
   returns no patient; call preparation rejects it rather than guessing.
2. `GET /api/operator/family-contacts?facility_id=...&patient_id=...` reads the
   authorized patient's contact. Destinations are private and only returned in
   authenticated configuration/review responses, not routine call history.
3. `PUT /api/operator/family-contacts/:uuid` intentionally creates a contact when
   `expected_revision=0`, or updates the same facility/patient contact with its
   current revision. Send contact name, relationship, E.164 phone, consent status
   and `consent_confirmed:true`. One primary contact per fictional patient is
   enforced in PostgreSQL. Every edit invalidates unsent queued authorizations.
4. `POST /api/operator/incidents/:id/notifications/preview` accepts `contact_id`
   and `expected_revision`. It requires a persisted explanation and consented,
   historically associated contact. The server builds a neutral score-free
   projection and stores the complete reviewed snapshot for ten minutes. New
   `family-call-v3` previews include `context.resident_name`, taken from the fictional
   patient's saved display label at the incident-time room assignment. Show this
   name with the review, separately from the recipient. The incident summary names
   the resident after recipient verification; the agent can answer identity questions
   from frozen facts. Missing/blank or over-120-character names block preparation.
   Historical contexts may omit this field; existing snapshots are never enriched
   silently, and the policy change invalidates unsent older authorizations. The
   response includes `preview_id`, hash, expiry, private recipient, context,
   opening, policy/version and `dispatch_enabled`.
5. `POST /api/operator/incidents/:id/notifications` accepts the preview ID/hash,
   expected incident revision and `explicit_authorization:true`, with an
   `Idempotency-Key` header (8–128 characters: letters, digits, `- _ : .`). It
   returns `202 {call}` only after authorization/job/audit commit. Browser-supplied
   facts, destinations and policy are rejected. A repeated identical key returns
   the existing call; changed content conflicts.
6. `GET /api/operator/incidents/:id/notifications` returns redacted call attempts,
   transport, notification evidence and optional callback request. It omits phone,
   context, hashes, provider payloads and provider IDs.
7. `PATCH /api/operator/incidents/:id` uses the incident-action schema and an
   `Idempotency-Key`. Lifecycle steps are pending → acknowledged → responding →
   resolved; resolution may specify reported_fall/false_alarm/unknown. Notes and
   action results are audited with the authenticated account, which need not
   represent an individual staff member.

No confirmation checkbox defaults to approval. A preview/contact edit must be
shown before an operator explicitly authorizes. A deliberate retry requires a new
preview, authorization key and `retry_of` pointing to the latest failed/completed
call. Unknown or still-active calls cannot be retried through this endpoint.

## Durable dispatch and callbacks

The dispatcher claims queued work with PostgreSQL row locks and rechecks membership,
consent/contact revision, historical assignment and policy. Authorization expires
for dispatch ten minutes after creation. It commits a unique attempt before any
external request. An expired or changed authorization fails without calling.

The ElevenLabs adapter submits a server-side outbound SIP request with the frozen
family context, opening, call/attempt identifiers and configured agent/phone IDs.
It uses a ten-second timeout and bounded response parsing. It never automatically
retries a telephone submission. Definitive request rejection becomes failed;
network errors, 5xx/429, invalid acceptance or interruption become unknown. A crash
between the committed attempt and correlation becomes unknown after thirty seconds,
without redial. Provider acceptance stays initiating until actual session evidence
arrives; it does not establish connection or speech.

`POST /api/webhooks/elevenlabs` verifies the exact body using the configured HMAC
secret, a 30-minute past/future timestamp bound, and the configured agent ID.
Only transcription-complete/initiation-failure envelopes are supported; audio
payloads are rejected. Store only normalized terminal status, optional boolean
callback request, safe failure code and correlation. Full transcripts, audio,
free-form provider analysis and recipient numbers are not persisted from callbacks.

Semantic event hashes deduplicate replay. A callback arriving before the outbound
response is retained as an orphan and reconciled atomically when the conversation
ID arrives. Reordered failure events cannot replace a completed state. Private
call tables have RLS and no browser SELECT grants. Incident revision updates in
those same transactions drive existing authorized Realtime invalidation/refetch.

## Spoken-notification evidence is still a provider gate

Notification success is connected **and** incident notification spoken. No recipient
acknowledgment, completed dialogue or subsequent action is required; hanging up
after the notification still counts. `notification_success:false` means success
has not been established; it is not by itself a failure verdict.

The current callback adapter deliberately does **not** turn transcript text, an LLM
analysis flag, call duration, provider acceptance or session completion into playback
proof. `connected` and `notification_spoken` remain false until the actual provider's
evidence mapping is verified and implemented. This is an explicit remaining task,
not a mandatory conversation-outcome classifier. A synthetic callback test never
establishes that an actual family member heard a message.

## ElevenLabs agent setup to verify when access arrives

Use the exported `POLICY` and `POLICY_VERSION` in
`apps/backend/src/notifications/policy.ts` as the reviewed agent policy. Configure
the first message as `{{opening_message}}` and include `{{family_context}}` as data
in the system prompt. Runtime variables also include call/attempt IDs and context
fields. Do not enable tools, live database retrieval, emergency transfer or
independent follow-up calls. Verify voice/language/model support before choosing
the preferred Gemini Flash candidate. The initial opening asks for the named
recipient without disclosing incident details; disclose the frozen summary only
after recipient confirmation, never to voicemail or an unverified recipient.

Connect the actual Photon outbound SIP trunk/number in ElevenLabs and then record
`ELEVENLABS_AGENT_ID` and `ELEVENLABS_PHONE_NUMBER_ID`. Configure signed post-call
callbacks at `https://api.blissey-beacon.health/api/webhooks/elevenlabs` after backend
deployment, save the secret server-side, disable unnecessary audio retention, and
verify provider-side transcript retention/deletion settings. The documented
[ElevenLabs outbound API](https://elevenlabs.io/docs/api-reference/sip-trunk/outbound-call)
and [webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks)
do not establish Photon compatibility or playback evidence.

## Frontend ownership

Keep Emilia's incoming Paper/frontend work intact. This PR does not redesign views
or claim Paper parity. Frontend work should use the shared DTOs above for patient
contact configuration, preview/approval, incident actions and call history; refresh
both workflow and call history after an incident revision update. Never label
transport completed as notification success without the evidence fields. Preserve
pending explanation rendering and facility-authenticated reads.

## Verification and rollout

Use `docker compose run --rm verify` and `sh scripts/verify-realtime.sh`. All call
fixtures/provider responses/webhook signatures use synthetic credentials/numbers.
The latter runs the real local PostgreSQL/Realtime engine and a synthetic call
path; it makes no external telephone request. Hosted Gemini has separate evidence
in `docs/deployment-verification.md`; it does not establish live telephony.

After review/merge, back up the approved hosted demo and apply only
`20261018022000_family_calls.sql`, recording its version. Deploy the backend with
calling disabled. Configure the consented contact intentionally through the
operator API. Enable live dispatch only after the provider/agent/evidence gates
above are settled, then perform an explicitly reviewed test call. Do not run test
bootstrap/reset SQL against the hosted project.

The final Docker verification passed formatting/lint, generated contracts,
typechecking, unit tests/builds and 27 database tests, including effect-at-commit
failures that prove no external call occurs before a durable attempt. Actual local
Realtime observed synthetic call-state commits and authorized REST returned the
redacted history; the no-membership client observed no updates. Live voice, SIP,
recipient verification, spoken-message evidence mapping and frontend screens remain
unverified. The hosted Gemini rollout was separately verified with the real provider.

## Provider configuration verification — 2026-10-18 UTC

The supplied Photon project/API credentials were verified against the official API.
The configured caller number belongs to the project, its assigned SIP profile has
outbound SHA-256 digest authentication, and its username matches the local setup.
The SIP endpoint certificate validated over TLS on port 5061. The user explicitly
approved storing the SIP username/password in ElevenLabs for outbound authentication.

A dedicated ElevenLabs agent, HMAC webhook and imported Photon outbound number were
created and read back successfully. Generated IDs and the webhook secret are saved
in ignored local deployment configuration. The imported trunk uses TLS with media
encryption allowed and the configured agent assignment. Configuration acceptance
and TLS reachability do not prove successful SIP digest negotiation or a phone call.

Verified agent configuration:

- Conversation model: `gemini-3.5-flash-lite`.
- English speech model: `eleven_flash_v2` (the provider rejected `eleven_flash_v2_5`
  for this English-agent setup).
- Post-call analysis: `gemini-2.5-flash`; the provider rejected the conversation
  model for its separate analysis role. Analysis only extracts optional callback
  metadata; it is not incident classification or proof of notification success.
- No tools, database retrieval or knowledge base; five-minute maximum duration.
- Concurrency one, daily conversation cap ten, bursting disabled.
- Voice recording disabled; one-day provider retention with audio and transcript/PII
  deletion configured. Backend callbacks exclude full transcripts and audio.

Two real-provider text simulations used fictional data and made no telephone
request. The initial callback response incorrectly promised staff would respond
soon. `family-call-v2` now requires a bounded acknowledgment with no promise of
contact or timing. Retests communicated unknown condition/staff response, extracted
an explicitly requested callback, and disclosed no incident details to the wrong
recipient. These are text/model behavior checks, not live voice, recipient
verification, SIP compatibility or audio-playback evidence.

Photon API credentials are administrative setup inputs. Runtime dispatch needs
only the ElevenLabs key, configured agent/number IDs and HMAC secret. Keep
`NOTIFICATION_CALLS_ENABLED=false` during rollout and until an explicitly reviewed
first-call test. Neither populated credentials nor this verification initiates a call.

## Hosted contact/review rollout — 2026-10-18 UTC

PR #8 merged at `d6f96b1` after all checks passed, including the revised policy.
Only `20261018022000_family_calls.sql` was applied after a private snapshot, and
its version recorded. Existing incidents/explanations were preserved. Railway's
server-only ElevenLabs variables were staged with live dispatch false, then the
merged revision deployed successfully. Photon API/SIP credentials were not copied
to the backend runtime or browser.

The authenticated operator API saved the explicitly consented test contact against
the fictional resident, resolved historical room assignment and produced a
`family-call-v2` review preview with dispatch disabled. Anonymous history and an
invalidly signed callback both returned 401. The deployed database had zero
notification authorizations and zero dispatch attempts after this check. No
telephone request was made, and actual callback delivery, SIP digest negotiation,
connected/spoken evidence and live voice remain unverified. Private contact/preview
receipts are kept in the ignored verification folder. Do not commit the number.

A live test still requires explicit approval of the intended recipient, opening,
family-safe context and bounded policy. Merely providing provider credentials or
consenting to be the demo recipient does not authorize an incident-specific call.

## First consented live smoke — 2026-10-18 UTC

At the user's explicit request, an authenticated synthetic v2 high-fall-score
event created an active incident, received a persisted Gemini explanation, and
was acknowledged through a simulated operator action with an honest audit note.
The operator API then reviewed and authorized one frozen `family-call-v2` session
to the user's saved, consented test contact. This was a synthetic incident, not
evidence of a physical fall or QNX hardware integration.

ElevenLabs accepted the outbound SIP request through the configured Photon trunk.
The user confirmed receiving the call. The provider reported a 63-second session
ending with `Client disconnected: 1000`, no provider error, and a 15-turn transcript.
After an initial voicemail greeting, the live recipient identified themselves and
the agent stated the approved Room 102 sensor summary and unknown resident
condition. The user reported that the conversation was imperfect but useful.

The signed provider callback persisted `completed` in Supabase. Exactly one call
authorization and one dispatch attempt exist for this incident. Live dispatch was
then disabled again, and Railway successfully deployed that configuration. No
second call was placed.

Observed limitations:

- The generic sensor summary did not explain what happened when the recipient
  asked for clarification. A supported, reviewed possible-fall interpretation still
  needs its own approved rule; do not silently reinterpret confidence scores.
- The agent treated an ambiguous closing response as a callback request, and the
  callback flag was persisted. It was not an explicit callback request and must
  not be counted as successful callback extraction or automatic staff dispatch.
- The recipient reported hearing the call, and the transcript contains the incident
  summary followed by their question. Automated playback-evidence mapping remains
  unverified: `connected` and `notification_spoken` remain false in the database,
  so `notification_success` is not established automatically. Do not replace these
  evidence checks with transcript text or session completion alone.
- Frontend contact/call controls and result presentation remain pending.

The recipient's primary feedback was that the agent could not identify the patient.
The original approved context contained no resident name. The follow-up correction
adds the historical patient's fictional display label to new reviewed contexts and
the incident summary, with recipient-verification restrictions. Existing call
records retain their original context; this correction does not place another call.

The correction passed Docker formatting/lint, contract generation, typechecking,
unit tests, builds and 28 database tests. Regression coverage verifies historical
assignment, name freezing despite later patient-label edits, and rejection of
missing/overlong identity. Two additional real-provider text-only simulations
answered the verified recipient's patient-name question with the supplied fictional
name while preserving unknown condition, and withheld resident/room details from
a wrong recipient. The dedicated agent prompt was updated to `family-call-v3`;
these checks did not place a telephone call or establish live voice retest results.

The full transcript and private provider receipts remain in ignored local
verification storage, not repository source or the application database. Provider
retention/deletion settings remain as documented above.
