# Photon iMessage family follow-ups and replies

Status: Approved direction in the user's amended review; implementation/verification pending.

## Affected sections

§§18–20, 23–27 and ADR-029. §20 defines messaging persistence, dashboard handoff,
security, acceptance, testing and fallback requirements used by those sections.

## Previous requirements

Explicitly authorized conversational calls through ElevenLabs/Photon; one saved
consented contact, frozen context and call evidence. No iMessage channel or reply inbox.

## Revised requirements and rationale

Add independently consented Photon-hosted iMessage. Authorize two frozen candidate
messages together with a call. Deterministic confirmed evidence chooses one generic
missed-call message or a grounded summary; unknown evidence requires operator review.
Generic messages omit resident and incident details. Recheck per-recipient assignment;
never assume the configured sender works for every contact. Durable authorization,
attempts, stable provider idempotency and reconciliation prevent duplicate sends.
Allow separately reviewed factual updates. Persist bounded inbound replies and surface
acknowledgments/callback requests without another Gemini call or promises of action.
Ambiguous multi-incident replies go to an operator inbox, not a guessed incident.

## Preserved contracts

Seven-field v2 event, four-field Gemini output, device/auth/incident persistence,
operator authorization, historical patient assignment, voice integration and Docker CI.

## Superseded assumptions

Voice-only communication and a single undifferentiated channel consent are insufficient
for messaging. Connected/completed calls are not proof that information was communicated.

## Unresolved implementation / evidence

Photon API scopes, actual sender/recipient assignment and inbound onboarding, live
send/receive, provider call-evidence mapping and Paper frontend controls require evidence.
Live integration and prize eligibility must not be claimed from synthetic tests.
