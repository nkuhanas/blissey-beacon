# Development and demo scripts

All commands below run Node/pnpm inside Docker. No host Node installation, database
administrator password, Supabase service-role key, or direct provider-call shortcut
is needed for the incident smoke. Existing `verify-realtime.sh` stays available.

## Fast one-shot Room 101 incident

```sh
sh scripts/incident101.sh
```

Publishes one **synthetic possible-fall** incident to room **101** through the
configured authenticated operator API and exits immediately after durable creation.
The dashboard receives the existing Realtime update; Gemini continues asynchronously.
No acknowledgment, family call, text, or Pi credential/health change is performed.
Each fresh invocation creates a new incident. The backend's scenario limit is ten
per operator per minute.

Uses `.env.deploy.local` with `SMOKE_API_URL` (or `VITE_API_URL`), `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `DEMO_OPERATOR_EMAIL`, `DEMO_OPERATOR_PASSWORD`, and
optional `SMOKE_FACILITY_ID`/`VITE_FACILITY_ID`. Use `--env FILE` for another profile.
It needs the existing Docker toolchain image (`docker compose build toolchain` once).
There is no per-run build, package installation, SDK dependency or Gemini wait.
A private, short-lived access-token cache avoids repeated logins; repeat runs need
only the incident POST. Credentials are read as dotenv data, never shell-sourced.

The command prints a request key before publishing. If interrupted or uncertain,
retry **that same intent** with its key (and the same `--env FILE`, if used):

```sh
sh scripts/incident101.sh --key <printed-UUID>
```

Journals under `.smoke/runs/` preserve idempotency, so that retry cannot create a
second incident. Do not use a fresh key to retry an ambiguous submission.
Room 101's actual Pi data path remains independent; this is a labeled synthetic
operator scenario, not evidence of hardware sensing.

## Local checks

```sh
sh scripts/verify.sh             # lint, format, types, contracts, unit/build/DB tests
sh scripts/verify.sh --realtime  # also exercise the isolated Supabase Realtime stack
```

These commands replace only the disposable `test-db` container, whose data is
temporary. They do not reset or migrate the hosted Supabase project. Script tests
use synthetic events, contacts and provider responses; CI never places calls.

## Configuration and read-only checks

Copy the relevant placeholders from root `.env.example` into `.env.deploy.local`
(ignored by Git, keep mode `600`). Existing populated deployment configuration can
be reused. Dotenv is parsed as data, never shell-sourced. Shell environment values
override the selected file; use `--env PATH` to select another ignored file.

| Input                                                                                 | Used for                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `SMOKE_API_URL` or `VITE_API_URL`                                                     | Backend origin; remote services require HTTPS                       |
| `SUPABASE_URL` or `VITE_SUPABASE_URL`                                                 | Supabase project origin                                             |
| `SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_PUBLISHABLE_KEY`                         | Auth and authorized Realtime                                        |
| `DEMO_OPERATOR_EMAIL`, `DEMO_OPERATOR_PASSWORD`                                       | Provisioned operator with facility membership                       |
| `DEVICE_WS_URL`, `DEVICE_TOKEN`, `DEVICE_ID`                                          | Authenticated simulator; WSS origin must match the API              |
| `SMOKE_FACILITY_ID` or `VITE_FACILITY_ID`                                             | Authorized facility (default `demo_facility`)                       |
| `SMOKE_ROOM_ID`                                                                       | Room assigned to the device (default canonical fixture's room)      |
| `DEMO_FAMILY_PHONE_E164`                                                              | Exact allowlist match against the existing saved, consented contact |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`                                           | Optional provider configuration/policy readback                     |
| `RAILWAY_TOKEN`, `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_SERVICE_ID` | Optional service-wide dispatch management                           |

```sh
sh scripts/demo.sh --help
sh scripts/demo.sh doctor
sh scripts/demo.sh doctor --run rehearsal-001 # also compare the saved policy with the live agent
sh scripts/demo.sh dispatch status
```

`doctor` checks process health, operator sign-in, authorized room reads and actual
PostgreSQL Realtime subscription readiness. If management credentials are supplied,
it also reads the agent voice/end-call configuration and Railway flag/deployment.
It creates no incident or call. It does not validate the device token by ingesting,
prove a Gemini call, prove playback, or inspect the recipient's iPhone settings.
With `--run`, the optional agent readback compares its actual prompt to that run's
saved reviewed policy without creating another preview or authorizing anything.

## Full incident smoke including one real call

First deploy the matching backend/agent policy, provision fictional demo room/device/
patient records, operator membership and **one saved consented primary contact**.
The script never creates contacts or accepts an arbitrary phone destination. Gemini
and ElevenLabs/Photon must already be configured server-side. Save the incoming
Photon number in the test iPhone's Contacts so Live Voicemail does not answer first.

```sh
sh scripts/demo.sh smoke --run rehearsal-001 --call --manage-dispatch
```

Use a fresh descriptive run name for a deliberately new scenario. The command:

1. Saves a canonical v2 synthetic event with current detection time before sending.
2. Signs in as the configured operator and opens a facility-scoped Realtime subscription.
3. Sends authenticated WSS ingestion, then resends the **same payload/ID** and
   requires a duplicate ACK referencing the same durable incident.
4. Reads the authorized incident, waits up to two minutes for its explanation,
   simulates an operator acknowledgment with an honest audit note, and requires
   an observed incident change through Realtime. It keeps the incident active.
5. Resolves the incident-time patient/contact, verifies consent and the exact
   destination allowlist, and prints the resident, masked contact, frozen context,
   opening, complete policy and context hash for review.
6. Requires the terminal user to type `CALL <hash prefix>` after reviewing those
   inputs. This is the specification's explicit call authorization gate.
7. If ElevenLabs admin credentials are available, verifies the actual agent prompt
   matches the reviewed backend policy, and checks the required hang-up control,
   including its explicit closing description when included in the policy.
8. With `--manage-dispatch`, enables Railway's flag if previously disabled, waits
   for deployment and a call-enabled preview, then submits **one** authorization.
9. Saves the authorization intent/idempotency key before POST and polls call status
   through the operator API until a terminal provider callback is persisted.
10. Restores the previous dispatch flag, including on failure/interruption, and
    waits for restoration deployment. An already-enabled service stays enabled.

`--manage-dispatch` enables the **whole selected Railway service**, including any
other already-authorized queued work. Use it only on the dedicated demo backend
after checking outstanding calls. It is not a per-run switch or a cancellation
mechanism. Alternatively, explicitly run `dispatch on`, wait for deployment, run
the smoke without `--manage-dispatch`, then use `dispatch off` afterward.

No credentials on command lines. Review output masks the destination and logs
redact configured secrets. The private `.smoke/runs/NAME.json` journal contains the
reviewed destination/context and is written atomically with mode `600`; the parent
directory is private. Do not commit or share it. JWTs and passwords are not saved.

## Prepare now, authorize later

Default `smoke` prepares and displays the review **without placing a call**:

```sh
sh scripts/demo.sh smoke --run rehearsal-002
# Review the recipient, context, opening and policy printed above, then use its hash:
sh scripts/demo.sh call --run rehearsal-002 --approve FULL_CONTEXT_HASH --manage-dispatch
```

This two-step flow works without a terminal for the final command. `--approve`
authorizes that exact reviewed context, not any future preview; a revision, contact,
policy or fact change requires new review. Do not automatically scrape and approve
hashes without operator review. The backend still validates membership, contact,
consent, policy, expiry, revision and idempotency before dispatch.

## Status, recovery and limits

```sh
sh scripts/demo.sh status --run rehearsal-001
sh scripts/demo.sh dispatch status
sh scripts/demo.sh dispatch restore --run rehearsal-001
```

Reusing a run with an existing call only monitors that call. It never retries a
failed/unknown/completed call or requests `retry_of`. A lost authorization response
is reconciled through call history; if no call is visible, the pending intent blocks
another POST. Inspect/reconcile it manually rather than deleting the journal or
starting a new run as a retry. The stable backend idempotency key also remains in
the journal for investigation. A transport timeout never proves that no call happened.

Local run and dispatch locks prevent overlapping commands. After a crashed/killed
process, inspect status and running containers before removing a stale `.lock`.
SIGINT/SIGTERM attempts restoration; SIGKILL, Docker shutdown or network loss can
prevent cleanup. If restoration remains pending, use `dispatch restore --run` and
then verify deployment. Submitted calls may continue even after disabling dispatch.

`--timeout SECONDS` bounds call/callback monitoring (default 360). A failed/unknown
transport or timeout exits nonzero without redialing. Completed transport is
reported separately from `notification_success`: **completion alone does not prove
the incident was spoken**. `--require-spoken` requires that provider evidence and
exits nonzero while mapping remains unverified. `--allow-fallback` explicitly allows
a labeled deterministic explanation; otherwise a fallback fails the Gemini stage.
On a resumed run, stored Realtime observations are historical evidence; they are
not represented as fresh delivery. The script does not verify rendered dashboard
pixels, QNX hardware, a physical fall, clinical validity, or recipient action.

## Verification record — 2026-10-18 UTC

The local Docker verification wrapper passed repository lint/format, generated
contracts, typechecking, unit tests/builds, 12 initial script tests and 28 database tests.
A further regression test covers a permissive end-call description even when the
main prompt matches.
The script tests cover lost authorization responses, no-effect ambiguous submissions,
changed reviews/consent/destinations, duplicate runs, deployment waiting, cleanup
failure recovery, private journals/locking and credential/redirect boundaries.

Hosted `doctor` verified sign-in, authorized Room 102 reads, PostgreSQL Realtime
subscription readiness, Sarah/v3-conversational with native end-call control and
Railway successfully deployed with dispatch disabled. The preparation-only smoke
then ingested one synthetic event, verified the duplicate ACK retained the same
incident, observed actual Realtime, read the real Gemini explanation and produced
a reviewed context naming the fictional resident. Preparation did not authorize
a call. At the user's subsequent explicit request, the `call --run ... --approve
HASH --manage-dispatch` command authorized one real call against that same incident.
The provider reported a 56-second session terminated by `end_call`; the signed
callback persisted completion, the database showed one call/attempt for the run,
and the script restored dispatch to disabled and verified its deployment before
exiting successfully. The recipient reported overly cheerful delivery and a
premature hang-up; these are conversation defects, not evidence of a flawless demo.
Automated spoken-delivery evidence remains unverified. Earlier live calls are in
[the family-call record](../docs/family-calls.md).

## iMessage routing check

`sh scripts/imessage-check.sh` verifies the configured Photon sender against
DEMO_FAMILY_PHONE_E164 and shared-line onboarding. It resolves users/a direct
conversation but sends no messages. See [family-messages.md](../docs/family-messages.md).
The call smoke can review and preauthorize messaging with `--with-imessage`;
selection still follows the reviewed evidence policy described below.

## Include a reviewed iMessage after the call

Use `sh scripts/demo.sh smoke --run NAME --call --with-imessage --manage-dispatch`.
The review shows both the generic missed-call text and the post-call acknowledgment;
its approval hash binds the voice and messaging hashes. `--with-imessage` on a
prepare-only run also works, followed by `call --approve` using that combined hash.
Independent messaging consent and the recipient's verified Photon assignment are
still required. Existing call-only approvals never acquire messaging implicitly.

A completed call alone does not establish that the incident notification was spoken. While the
provider's playback mapping is unverified, the operator classifies communicated
versus missed evidence through the existing message-review API. Recipient-confirmed
communication selects the preauthorized acknowledgment; voicemail selects the generic
message. Unknown outcomes wait for review. See [family-messages.md](../docs/family-messages.md).

For a confirmed staff dispatch, add `--confirm-staff-dispatch` to the fresh joint
review (`--with-imessage`). This is an operator assertion that dispatch already
occurred; it does not dispatch staff. The reviewed successful-call candidate then
thanks the recipient and states that the care team was dispatched and will provide
updates. Omit the flag when unconfirmed; an active alert or `responding` state alone
is insufficient. Both variants replace the incident recap and retain reply/STOP
instructions. The combined approval hash binds the actual selected text.
