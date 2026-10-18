# Post-call thank-you acknowledgment

Status: Approved. The user accepted the proposed post-call wording after the
explicit clarification that dispatched wording depends on operator-confirmed
dispatch. Affects PROJECT_SPEC.md §20 and ADR-035; message preview and smoke review.

Previously, successful-call follow-ups repeated the possible-fall summary and
uncertainty text. New confirmed-dispatch follow-ups say:

> Thank you for speaking with us. Our care team has been dispatched and will keep you updated as the situation develops.

An authorized operator must explicitly provide staff_dispatch_confirmed: true for
that follow-up preview. Record the actor, incident/revision and preview in audit;
freeze the exact template in the existing approval hash. Do not infer dispatch
from alert state, responding state, call completion or model output. The flag
confirms an action already taken; it does not dispatch staff or automate updates.
Without confirmation, thank the recipient and direct them to their care team for
updates, without the dispatch claim. The confirmed template includes the approved
commitment to further updates, not a claim that an update was already delivered.

Preserve separate consent, communicated/verified-recipient evidence, operator
review, idempotency, generic missed-call privacy and reply/STOP controls. Keep the
legacy summary wire field/selection and all historical frozen messages. No QNX,
Gemini, voice schema, frontend or database migration is required. This change
places no call and sends no additional message to replace an already delivered one.
