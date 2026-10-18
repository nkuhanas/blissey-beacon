# Direct active-alert wording and recipient-led closing

Status: Approved by the user's explicit requests after reporting a successful call:
remove the anything-else prompt, and use active-alert wording instead of describing
the care-team response as unknown/not responding. Affects PROJECT_SPEC.md §20,
§23 and ADR-034; family-call context and voice policy.

Previously, the policy asked whether the recipient needed anything else when
closure was unclear and could volunteer unconfirmed staff response. New v8 calls
pause after the summary/answer and wait for the recipient. Do not add generic
help or wrap-up questions. Preserve explicit goodbye/stop and voicemail handling;
do not infer closure from acknowledgment, satisfaction or silence.

Freeze optional persisted incident_status in reviewed notification contexts.
Pending/acknowledged/responding snapshots support "This is an active alert."
Resolved snapshots are identified as resolved at review; historical missing-status
contexts do not assume an active alert. This avoids inventing staff action or
absence. Unknown resident condition remains separate. Keep historical contexts
readable and immutable. Preserve the approved callback commitment, consent,
operator approval, sensing/Gemini schemas, identity and notification evidence rules.
The notification-only lifecycle field does not change QNX events or Model 2.
No new call or message is authorized by this voice-policy amendment.
