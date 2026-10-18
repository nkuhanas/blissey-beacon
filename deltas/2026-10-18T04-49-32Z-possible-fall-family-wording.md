# Possible-fall language for the family demo

Status: Approved by the user's explicit request for stronger fall-related wording
in iMessages and calls. Affects PROJECT_SPEC.md §20 and ADR-030.

## Previous requirement

The shared family summary said "A sensor result was recorded for [resident] in
[room]. Their condition has not been confirmed." It supplied both the call's
frozen context and the post-call iMessage template.

## Revised requirement and rationale

For the operator-reviewed staged fall demo, use:

> We're contacting you about a possible fall involving [resident] in [room]. Their condition has not been confirmed.

The wording communicates why the family is being contacted while preserving
uncertainty. It is an approved demo-scenario description, not a new classifier
threshold or a confirmed physical fall. Operators review/authorize the exact
summary before use; the voice agent relays it only after recipient verification.
The reviewed iMessage summary consumes the same frozen text.

## Preserved contracts and limits

Keep the seven-field v2 inference_result/confidence_scores schema, Gemini output,
consent, generic missed-call privacy, operator authorization, unknown condition,
unconfirmed staff response and no injury/diagnosis claims. Do not overwrite any
previously approved context. New previews receive the new wording and hash.
No live message/call, provider-prompt change or deployment is part of this copy edit.
Actual classifier validation and hosted rollout remain separate evidence requirements.
