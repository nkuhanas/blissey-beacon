# Connected operator dashboard

The styled dashboard at `/` now supports Supabase operator sign-in. `/?operator=1`
opens its sign-in dialog. `/?demo=1` preserves the browser-only fixture experience:
its actions never invoke operator APIs or providers. `/?legacy=1` retains the old
integration shell for troubleshooting.

## Rehearse from the UI

1. Sign in with the provisioned operator account and assigned facility membership.
2. Open the collapsed **Scenario controls** at the bottom of the page, select a room/scenario and choose **Instantiate**. This is an authenticated
   server operation, not a reset of browser fixtures. A fresh incident is labeled
   synthetic and recorded durably with a pending explanation job. Gemini processes
   it using the existing worker; the scenario does not guarantee provider success.
3. **Acknowledge incident** persists the incident action and opens the family call
   review. Responding, resolution and notes also use the existing revision-checked API.
   A false-alarm resolution follows the existing responding → resolved transition.
4. The family popup automatically prepares frozen incident/contact facts and both
   possible follow-up texts. Review details as needed, check the single authorization
   checkbox and choose **Yes, notify family**. This authorizes one real call and its
   automatic follow-up text; channel consent and provider flags remain required.
5. Call transport, provider-reported outcome, text delivery and replies appear in
   the same dialog. Follow-up selection is automatic, including a privacy-safe generic
   message for unclear terminal outcomes. There is no post-call operator review for
   new approvals. Staff dispatch is not inferred or asserted by the simple popup.

Ambiguous call-authorization responses are reconciled using persisted history;
there is no automatic resend or redial. Existing calls are shown instead of issuing
another authorization. Use a new scenario for a fresh rehearsal; an explicit retry
workflow for existing calls is not added in this slice.

Fictional names remain visible. The real consented test phone is configured only
on the backend and is omitted from the dashboard room DTO. Creating a scenario
provisions missing six-room fictional records and contacts; it preserves existing
patient assignments, contacts, revoked consent and the Pi device `1` / room `101`.
A pre-existing resident assignment without a consented contact needs administrative
configuration before that room can authorize calls. Scenario-created devices use
`dashboard_sim_*`, have no device credentials and do not impersonate the Pi.

“Deterministic fallback” creates a clearly synthetic fallback, not a simulated
Gemini success. “Monitoring outage rehearsal” and “No new incident” record rehearsal
markers without fabricating health reports, deleting history or resolving alerts.
The room map continues to show persisted active alerts even when monitoring is offline.

## Configuration and interfaces

Use the existing Vercel public variables `VITE_API_URL`, `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_FACILITY_ID`. Configure the backend origin
for the actual frontend origin. No operator password, device token or provider key
belongs in the browser build.

Apply `supabase/migrations/20261018080000_dashboard_scenarios.sql` after existing
migrations. For controlled rehearsals, set `DEMO_SCENARIOS_ENABLED=true`,
`DEMO_FACILITY_ID` and server-only `DEMO_CONTACT_PHONE` to the consented test phone.
`DEMO_FAMILY_PHONE_E164` is accepted as a local fallback. Existing notification
configuration and independent consent/authorization checks remain required.
Default scenario creation is disabled. Ordinary incident reads continue when it is off.

- `GET /api/operator/dashboard?facility_id=...` returns authorized room snapshots
  validated against `packages/contracts/schemas/dashboard-room.json`, plus
  `scenarios_enabled`. It omits private phone numbers.
- `POST /api/operator/demo/scenarios` accepts `demo-scenario-request.json` with an
  `Idempotency-Key`. It returns `scenario_id`, nullable `incident_id`, `room_id` and
  `scenario` after commit. Same-key retries replay the original result; conflicting
  reuse is rejected. A per-operator limit of ten new scenarios/minute applies.
- Incident, action, call, message and reply contracts are unchanged. Event persistence
  reuses the existing transaction implementation and canonical v2 inference contract.
- Supabase Realtime invalidates incident snapshots. Authorized REST refreshes on
  startup/reconnect and every five seconds; device status uses actual received
  health, becoming offline after the existing thirty-second staleness threshold.

When the Pi connects, its authenticated WSS events enter the same incident feed.
No frontend endpoint or schema switch is required. This feature is not evidence
that the physical Pi or classifier has been verified end to end.

## Local development and verification

For a connected local run, put backend-only configuration in `apps/backend/.env`
(ignored), set `WEB_ORIGIN=http://localhost:5173`, and configure the database CA
path for the container filesystem. Put only the four public `VITE_*` variables
in `apps/web/.env.local` (ignored), using `VITE_API_URL=http://localhost:3001`.
Build/install through Docker as described in the README, then run
`docker compose up web backend`. If using alternate published ports, update
`WEB_ORIGIN` and `VITE_API_URL` to match the URLs in the host browser.

The local check on 2026-10-18 used the styled frontend, authenticated Fastify API,
existing Supabase database/Auth and real Gemini processing. A UI-created synthetic
incident persisted, acknowledgment survived reload, and call/iMessage previews
were prepared for the fictional resident/contact. The preview performed the
existing Photon recipient-assignment check. No call or text was authorized by
that check. Browser authorization-failure checks use intercepted synthetic
responses before dispatch; they do not establish provider delivery.

Database regression tests cover identity/membership, concurrent idempotent retries,
conflicting keys, preservation of actual Pi assignment and revoked consent, phone
omission, synthetic fallback labels, unchanged hardware health/history and rollback
after writes. Realtime acceptance additionally exercises UI scenario creation,
idempotent replay, a single actual incident INSERT notification, authorized REST
reads and exclusion of an unrelated identity using disposable Supabase Realtime.

## Continuous synthetic rooms and reset

With `DEMO_SCENARIOS_ENABLED=true`, Railway updates one persisted synthetic sample
per unconnected demo room every ten seconds. Room 101 is always excluded; rooms
with active registered device credentials also use real telemetry. The six-sample
healthy confidence pattern loops without creating incidents, explanation work,
calls or texts. The Devices tab labels synthetic feeds separately. A stopped
worker becomes stale after thirty seconds rather than pretending to stay online.
Scenario controls stay collapsed at the bottom. Offline scenarios pause the
selected synthetic feed until a healthy scenario or reset.

**Reset room alerts** now archives that room's existing events and incidents from
normal dashboard/history reads, including resolved incidents. It is one atomic,
idempotent, facility-authorized request. Original payloads, retry/deduplication
identities, provider results and audit evidence remain durable. Reset never sends
a call/text or alters Pi credentials/health. New Pi events after reset remain
visible. Synthetic rooms return to their healthy baseline. A normally resolved
overview card clears after sixty seconds; its history entry remains until reset.

The demonstration facility is labeled **James West Alumni Center at UCLA**.
Residents and the illustrated room layout remain fictional. Pending possible-fall
alerts show a persistent review banner and slow pulsing card/map outlines. The
pulse stops after acknowledgment and is disabled for reduced-motion preferences.
