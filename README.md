# Blissey Beacon

Blissey Beacon is an experimental, camera-free possible-fall monitoring project
for LA Hacks 2026, intended for senior-home operators, caregivers, and authorized
family members. ESP32 Wi-Fi CSI feeds local inference on a Raspberry Pi 5 running
QNX, with a planned Railway Node.js/TypeScript backend, Supabase PostgreSQL and
Realtime, Gemini API explanations, and a public Vercel demo dashboard. Visitors
can perform demo incident actions without login and explicitly approve notifications
to preconfigured consented demo recipients. No developer laptop is required at runtime.

The repository currently contains documentation only. See
[PROJECT_SPEC.md](PROJECT_SPEC.md) for scope, architecture, proposed interfaces,
implementation priorities, and unresolved decisions. This is a proof of concept,
not a clinically validated fall detector or emergency response device.

## Getting started

TODO: Document prerequisites, installation, configuration, and how to run the project.

## Development

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[PROJECT_SPEC.md](PROJECT_SPEC.md) for project requirements and design decisions.

TODO: Add commands for building, testing, and linting as tooling is introduced.

## Changes to the specification

If proposed work contradicts [PROJECT_SPEC.md](PROJECT_SPEC.md), pause the
conflicting work and first propose a specification change and a timestamped Markdown delta file in
`deltas/` (for example, `deltas/2026-10-17T19-30-00Z-short-description.md`).
Describe the affected spec sections, the proposed changes, and why they are
needed. Obtain explicit approval before editing the spec, creating the delta
file, or implementing the conflicting work.

Once approved, update `PROJECT_SPEC.md` and create the timestamped delta file
documenting what changed in the spec and why. Include the affected sections and the previous
and revised requirements so the decision can be traced. Then proceed with the
approved work.
