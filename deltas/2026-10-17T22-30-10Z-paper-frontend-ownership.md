# Approved delta: Paper-assisted frontend and ownership

Date: 2026-10-17 (UTC)
Status: User-directed. Emilia explicitly requested using Paper to help design and
implement the frontend and updating the specification accordingly, after clarifying
that Chloe handles model/training work and Chace handles backend/scaffolding.
Canonical specification: [PROJECT_SPEC.md](../PROJECT_SPEC.md)
Baseline: `96efb9b` (latest fetched `origin/main`).
Scope: Documentation only; no Paper artifact, application change or deployment.

## Previous and revised requirements

| Sections | Previous | Revised | Rationale |
| --- | --- | --- | --- |
| 6, 19, 22 | Paper described as the dashboard design tool | Paper assists Emilia with frontend design and implementation; integrate the UI into the existing React/Vite `apps/web` application | Reflect the requested design-to-implementation workflow without assuming an unverified Paper export/integration capability |
| 18–19, 21, 23, 25, 28, 30 | Kiro owns frontend implementation, layout agreement, UI validation and backend coordination | Emilia owns those frontend responsibilities and coordinates shared contracts, layout and Realtime with Chace | Apply Emilia's stated ownership consistently |
| 19, 21 | Chace owns backend/Model 2; Chloe owns Model 1 and edge inference | Clarify Chace's application/backend scaffolding ownership; retain Chloe's Model 1/training/edge scope | Align the frontend handoff with the team's stated division of work |
| 19, 30–31 | Paper handoff link pending; no explicit implementation-assistance workflow | Record Paper link and corresponding source paths; review responsive implementation, keyboard access and required UI states; append ADR-029 | Make future design and implementation reviewable without claiming completion |

## Preserved contracts and limits

Retain React/Vite, Vercel, Supabase Auth/facility authorization, shared schemas,
backend REST and Supabase Realtime. Preserve room-centric incidents, static layout
semantics, explicit notification review, server-held secrets and the existing
hardware/CSI ownership. This amendment does not restore anonymous operator access
or change the QNX/model/event contracts. Historical ADRs and deltas remain intact;
ADR-029 supersedes their frontend-owner references.

Synthetic fixtures may support frontend work before live models/backend flows are
ready, with their source labeled. Paper access/link and the specific integration
or export method remain unverified. Design work is not evidence of a working
integration or sponsor eligibility. No services were provisioned and no code was
implemented as part of this amendment.
