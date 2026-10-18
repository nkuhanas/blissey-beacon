# Reassuring callback commitment for fictional demo voice calls

Status: Approved. The user selected "Approve the demo callback promise" after
reviewing the proposed wording and its distinction from automatic staff calling.
Affected: PROJECT_SPEC.md §20, §23, §31 (ADR-031); voice policy and setup guidance.

## Previous requirement

Voice policy family-call-v5 prohibited callback fulfillment promises and required:
"Your callback request is noted for operator review. I cannot confirm when or
whether staff will call."

## Revised requirement and rationale

For fictional demo voice calls only, use:

> Your callback request is noted. The care team will call you back as soon as possible.

The prior disclaimer sounded unhelpful to the test family recipient. The approved
scripted commitment is more reassuring without inventing a specific callback time,
a confirmed resident condition, an already-contacted staff member, or a scheduled
or completed callback. This narrowly supersedes the blanket voice prohibition;
iMessage templates remain unchanged.

## Preserved contracts and implementation limits

Keep v2 inference events, Gemini explanations, consent, recipient verification,
operator authorization, callback-request recording, incident lifecycle, native
hang-up rules and immutable historical approvals. Increment the voice policy to
family-call-v6; new previews and dispatch must agree on the new policy/hash.
No new schema, automatic staff calling, callback scheduling or notification is
introduced. Provider and backend policy alignment must be verified separately;
this delta itself is not evidence of a live call using the revised wording.
