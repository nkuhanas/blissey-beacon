# Approved delta: authenticated monorepo foundation

Date: 2026-10-17
Status: Approved. The user instructed folding the supplied review into the spec
and implementing the scaffold after reviewing the monorepo proposal.
Canonical specification: [PROJECT_SPEC.md](../PROJECT_SPEC.md)

| Sections | Previous | Revised | Why |
| --- | --- | --- | --- |
| 6, 18, 28 | Framework/package manager unselected | pnpm TypeScript workspaces; React/Vite web; Fastify with @fastify/websocket backend | Approved scaffold; preserve two deployables and separate QNX/Python tools |
| 18, 26 | Atomic persistence required, mechanism unspecified | pg with one checked-out client and explicit BEGIN/COMMIT/ROLLBACK; unique event/incident/job constraints and original payload comparison | Make transaction boundary concrete; independent REST calls are not atomic |
| 1, 3–6, 17–20, 23–28, 30–31 | Public demo without operator login (ADR-018) | Supabase Auth JWT, Railway signature/claim verification and facility authorization, Realtime RLS and explicit publication membership | User approved review's reversal of public access; shared demo login acceptable |
| 18–19, 30 | Patient/room mapping unresolved | Fictional patients, timestamped assignments, room floor/static geometry; Kiro finalizes layout DTO/units | Support top-down view without claiming inferred patient location |
| 15, 28, 31 | Approved seven-field v2 confidence-score event | Preserve exactly; JSON Schema authority, generated TS types, Ajv and native-consumable fixtures | Review's v1 reference is stale; do not restore superseded possible_fall/fall_score |
| 26, 28, 31 | General future QNX transport validation | Early actual Pi/QNX authenticated TLS WSS synthetic-event milestone before CNN integration | Desktop mocks do not validate QNX networking |

Preserve local CNN/task/training contracts, durable post-commit ACK, deduplication,
health/outbox semantics, four-field Model 2 output, durable Gemini jobs and Photon
consent/content review/idempotency. Gemini, Photon, deployment and QNX live tests
remain unverified. Authentication is account identity, not evidence of clinical
staff identity; a shared demo account cannot attribute individual people.

Append ADR-019–024; retain historical ADRs and prior deltas. Implement only Slice 1:
workspace, schemas/fixtures, foundation migrations/access policies and app/auth
shells. Later ingestion/worker/notification modules grow with later slices.

Open: Kiro's final layout contract/units, provider deployment configuration,
Supabase account provisioning, actual QNX/native parity, Gemini/Photon integration.
Any selected scaffold layout DTO is provisional; no live deployment is claimed.

## Approved Docker follow-up

The user explicitly requested Docker during implementation and asked to include it
in the spec. Section 28 and ADR-025 now select Docker Compose for Node/pnpm
development, app shells and automated validation, with disposable PostgreSQL
migration/RLS tests. No host Node/pnpm installation is required. QNX/Python retain
independent tooling. Container checks are not live Supabase or Pi/QNX evidence,
and local development containers do not add a production middleware dependency.
