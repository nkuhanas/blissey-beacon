# One-step family notification and automatic follow-up

Date: 2026-10-18
Status: Approved by the user in this session
Canonical specification: PROJECT_SPEC.md
Affected sections: 18–20, 23, 25–27, 30–32.

Previously, the connected dashboard required preparation, separate call/text approval controls, optional staff-dispatch confirmation and manual review of unclear post-call outcomes. The voice policy answered situation questions with only “This is an active alert.”

The approved workflow is acknowledgment → automatically prepared notify-family popup → one checkbox explicitly authorizing the call and its frozen follow-up candidates → “Yes, notify family.” Acknowledgment itself does not authorize a notification. Independent channel consent, identity checks, facility scope, frozen facts/text and durable idempotency remain enforced server-side. Extra facts/policy are available under details without blocking the happy path.

New follow-up approvals use a versioned automatic policy. Signed provider results record minimal reported outcomes; a reported verified recipient and communicated incident select the approved thank-you. Missed, incomplete and unclear terminal outcomes select the generic privacy-safe candidate, without operator review. Missing terminal callbacks are reconciled through the official provider API; irrecoverably uncertain attempts use the preapproved generic candidate after a bounded deadline. Never infer verified playback, comprehension, staff dispatch or medical facts from a completed session or model analysis. Preserve the old manual policy for old approvals and do not retroactively send historical held messages. Exactly one initial follow-up is persisted and dispatched per new authorization; consent and route checks still apply. The simple UI uses the non-dispatch-asserting thank-you unless separately recorded dispatch facts already exist.

For active incidents the voice agent answers situation questions with: “This is an active alert. We do not have all the details of the situation at this time.” When asked what happened, also restate the approved possible-fall summary rather than replacing it with a status label. Resolved/historical contexts retain truthful lifecycle wording. Improve noise/backchannel interruption handling while retaining genuine questions, recipient verification, calm delivery and explicit-only hang-up rules. Provider settings and simulated tests do not establish live audio quality.

Preserved: canonical seven-field v2 inference schema, Gemini output, local edge grouping/classification, authenticated WSS/room authorization, event/incident/job transaction, device-health truth, Supabase Auth/Realtime, explicit notification authorization and one saved consented contact per fictional resident. Keep actual Pi device 1 / room 101 and token hash unchanged; UI scenario identities remain separate. The user subsequently confirmed the Pi backend integration is already handled and removed Pi changes from this slice; leave that integration untouched.

Unresolved verification: real audio handling after interruption, complete speech delivery and the physical QNX-to-cloud path require actual hardware/call evidence. No live call or message is authorized merely by implementing or deploying this change.
