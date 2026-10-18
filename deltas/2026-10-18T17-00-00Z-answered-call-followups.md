# Answered-call follow-ups

Status: Explicitly approved by the user on 2026-10-18.

Affected sections: §20 notification policy, §23 immutable approval semantics, §26 validation and §31 ADR.

Previously, automatic-v2 selected the thank-you only from a provider-reported verified recipient and fully communicated incident. Other terminal outcomes selected a generic missed-call text; manual-v1 approvals could remain held for operator review.

Revised: new automatic-v3 approvals select the preapproved thank-you after a provider-confirmed answered call ends, regardless of callback request, identity analysis, interrupted explanation or early recipient hang-up. Unanswered/uncertain calls retain the preapproved generic text. This is transport evidence, not proof of recipient identity, message playback, resident condition or staff dispatch. New templates omit the ACK instruction while retaining CALLBACK and STOP; incoming ACK remains recognized for compatibility.

Use validated signed webhook metadata or authenticated provider GET metadata. Recover missing final callbacks throughout the bounded call deadline, promptly enough to cover a late hang-up. Retain exactly one follow-up, independent consent/Photon assignment validation, frozen wording/hash and no automatic redial or uncertain-send retry. Do not reinterpret historical manual-v1/automatic-v2 approvals or resend delivered messages.

Rationale: an answered family call should always leave a written follow-up, including when the recipient hangs up to act. Conversation analysis and callback requests must not gate this simple acknowledgment.

No real call or message is authorized merely by applying this delta. User separately requested skipping GitHub CI and deploying this fix; local validation remains required. ADR-040 records the decision.
