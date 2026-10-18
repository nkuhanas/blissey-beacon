# Care-assistant identity for family notifications

Status: Approved. The user accepted the proposed call and missed-call wording
with "yeah do that instead". Affects PROJECT_SPEC.md §20, §23 and ADR-032.

## Previous and revised requirements

Replace the caller's "automated demo assistant" introduction with:

> Hello, this is Blissey Beacon's automated care assistant. May I speak with [contact name]?

Replace the generic "automated demo service" missed-call wording with:

> This is Blissey Beacon. We tried to reach you with a care notification. Please contact your care team for an update.

Keep CALLBACK and STOP instructions. Use "Blissey Beacon care notification:" for
incident-summary messages. The voice policy becomes family-call-v7 and uses the
care-assistant identity in subsequent introductions, with automation still explicit.

## Rationale, preserved contracts and limits

The user wants a natural service introduction. Keep internal fictional/synthetic
labels honest and answer truthfully if asked whether this is a demonstration.
Preserve recipient verification, missed-call privacy, consent, exact-text approval,
reply routing, the approved voice callback commitment, unknown resident condition,
hang-up behavior, event/Gemini schemas and all frozen historical authorizations.
New previews carry new text/hashes and require fresh approval. No schema changes,
new staff actions, real phone calls or iMessage sends are authorized by this delta.
