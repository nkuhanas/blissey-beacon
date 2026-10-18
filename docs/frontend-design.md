# Frontend design handoff

Owner: Emilia. Design revision: editorial brand, 2026-10-17.

## Paper source

The [BlisseyBeacon Paper document](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0)
is the visual source for the next frontend implementation slice.

| Page | Screen / purpose |
| --- | --- |
| [Dashboard & accessibility](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0) | `Dashboard · Editorial · Desktop` (1440px), `Dashboard · Editorial · Mobile` (390px), and accessibility/interaction specifications |
| [Brand & components](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-2-0) | `Brand & interface · Editorial system`: approved logo, typography, semantic swatches, action/focus/unavailable specimens and status specimens |
| [Archive · Initial exploration](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-3-0) | Initial desktop exploration, retained for comparison |

The Paper artifacts remain editable design drafts and static component specimens.
A browser-only interactive implementation is now available in `apps/web` at
`/?demo=1`; the existing authenticated integration shell remains at `/`. The facility plan remains schematic; the
detailed architectural illustration in the supplied reference is not complete.
The demo includes room/incident selection, staged lifecycle actions, notes, contact
editing with consent, notification review, history and device views. Sign-in styling,
full failure-state coverage and backend integration of those views remain pending.
The additional Paper artboard `Demo · Family contact & call review` includes the
contact form and the review-dialog header; its review body is unfinished following
an interrupted Paper edit. The running review body follows section 20 of PROJECT_SPEC.
It does not establish complete visual parity for every interaction state.

## Identity and type

- [Approved logo](../design/brand/blissey-beacon-logo-v1.png): transparent PNG,
  1774×887. Imported into Paper through its native image uploader, then reused on
  desktop, mobile and the identity sheet. The wordmark is raster artwork; UI text
  remains editable. [Generation provenance](../design/brand/README.md).
- Instrument Serif Regular: page titles 56px/60px desktop, 40px/44px mobile;
  section headings 28px/34px; selected resident name 30px/36px.
- DM Sans: operational data, room IDs, statuses, navigation, controls and body.
  Room IDs use 26px/34px; summary counts 44px/52px, with tabular numerals specified.
  Body uses 16px/24px and supporting text generally 14px/21px.
- Bookish palette: plaster ground, plum ink, berry emphasis, blush alert surface,
  sage monitoring labels and slate supporting text. Do not use color alone to
  distinguish states; retain readable labels and redundant symbols.
- Spacing is based on 4px increments with an 8px primary rhythm. Controls use an
  8px radius; panels use 12px. Keep large display type away from urgent action
  labels and experimental confidence scores.

## Native Paper work and export

The document has 36 shared tokens covering semantic colors, fonts, type sizes,
weights, tracking, line heights, opacity, breakpoints, container width, spacing
and radii. Tokens are applied to revised typography and core surfaces, with
literal colors retained for a few semantic supporting fills. It uses editable
flex layouts, named layers, SVG status/decorative geometry, desktop/mobile
variants and primitives cloned from the dashboard into the component sheet.
Cloned primitives are specimens, not a claim of linked component instances.

[tokens.css](../design/brand/tokens.css) is exported directly from Paper's CSS
token tool. It is imported by the interactive dashboard stylesheet.
Read the chosen Paper nodes with `get_jsx` / `get_computed_styles` when implementing;
omit Paper node IDs from production JSX. Compare screenshots against the source
at desktop and mobile widths after implementation.

## Interaction and accessibility

Target [WCAG 2.2 AA](https://www.w3.org/WAI/WCAG22/quickref/). Design-time review
does not establish conformance of the app.

- Main actions are at least 48px high; use at least 44×44px interactive areas as
  the project design target. The focus specimen uses a 3px plum ring with 3px
  separation. Preserve visible focus and do not clip it.
- Provide native buttons/selects, a skip link and a logical DOM/focus sequence.
  Keep the room list available as an alternative to spatial map navigation.
  Detail views restore focus to the triggering control on close. Background
  Realtime updates do not steal focus.
- Mobile prioritizes the incident and room list; do not shrink the desktop map
  until its labels become unreadable. Test 200% text sizing and 320 CSS px reflow.
- Announce connection changes politely and new urgent incidents without repeated
  interruptions. Respect reduced-motion preferences; avoid flashing alerts.
- Explain unavailable actions. A pending incident must be acknowledged before
  marking responding. Acknowledgment does not approve a call.
- Each resident's family contact has name, contact information and explicit
  consent-to-call status. The shown contact is fictional and its destination is
  masked. Edit-form consent starts unchecked; contact details alone do not prove
  consent. Select a saved authorized contact at dispatch and preserve backend consent
  verification.
- Review the recipient, frozen family-safe context, opening and bounded
  conversational policy before call approval, as specified in PROJECT_SPEC section 20. Prototype
  actions must not send real calls/messages. No sensing, Gemini or Photon success
  is established by a design specimen.

Checked solid-color contrast ratios using sRGB relative luminance:

| Foreground / background | Ratio |
| --- | --- |
| Plum ink / plaster | 12.82:1 |
| Slate supporting text / plaster | 5.83:1 |
| White / berry button | 6.68:1 |
| Berry / blush | 5.86:1 |
| Sage / pale monitoring surface | 6.09:1 |
| Border `#807781` / white | 4.31:1 |

Desktop, mobile, identity and accessibility sheets were visually reviewed in
Paper for hierarchy, spacing, contrast, alignment, wrapping and artboard fit.
The logo import and CSS token export were verified. Browser keyboard behavior,
VoiceOver, zoom/reflow, real focus styles and form errors remain implementation
checks. Sponsor eligibility and award submission requirements were not verified.

## Run and explore the interactive demo

No Supabase account, backend, hardware or environment secrets are needed for demo
mode. With Docker and Compose installed, from the repository root:

```sh
docker compose build toolchain
docker compose run --rm toolchain
docker compose up web
```

Open http://localhost:5173/?demo=1. Alternatively, with Node 24 and pnpm 10.34.7:

```sh
pnpm install --frozen-lockfile
pnpm --filter @blissey/contracts build
pnpm dev:web
```

The local preview started during implementation used port 5174 because 5173 was
already occupied. Use the URL printed by Vite. The deployed website does not gain
this demo until the implementation branch is merged and deployed.

Try Room 104: acknowledge, mark responding and resolve; expand its timeline to
add a note. Edit a resident's family contact and uncheck consent to block call
review. New contacts start without consent. Review a notification, then explicitly
check the review confirmation to enable **Simulate call authorization**. This
shows a preview result without contacting a provider or claiming delivery.
Use navigation for residents, history and device health; use **Demo scenario**
for pending/ready/fallback explanations, all-offline sensing and no incidents.
**Reset demo** and page refresh discard all contact edits, notes and actions.

`Dashboard.tsx`, `model.ts`, `Icon.tsx` and `dashboard.css` in
`apps/web/src/dashboard` implement the Paper source using semantic HTML, native
buttons, labeled forms and native modal dialogs. The operator module is loaded
only outside demo mode; fixture actions cannot reach backend or provider APIs.
The authenticated operator UI, DTOs and Supabase subscriptions remain separate.

Validation: repository contract checks, formatting, lint, typechecks, all 19 unit
tests and production builds passed with Node 24.19.0/pnpm 10.34.7. The four new demo
model tests cover transition order, consent and resident scoping, offline labels,
notes/false-alarm history and reset. Headless Chrome browser QA passed lifecycle actions, consent revocation, call-review
confirmation, history/devices/empty views, unchecked new-contact consent, Escape
closure, modal focus cycling and restoration, and the operator entry link. Viewports
1440/1024/768/390/320 CSS px had no horizontal document overflow; desktop and mobile
screenshots were visually reviewed. Demo mode made no operator API or Supabase
requests and reported no uncaught browser errors. Full VoiceOver, 200% text sizing
and formal WCAG conformance remain unverified.
No database migration, hosted rollout, live inference or provider test was performed.
