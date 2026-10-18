# Frontend design handoff

Owner: Emilia. Current revision: Moonlit logo and reviewed enriched design, 2026-10-17.
The editorial base is preserved separately below.

## Paper source

The [BlisseyBeacon Paper document](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0)
is the visual source for the next frontend implementation slice.

| Page                                                                                            | Screen / purpose                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [Dashboard & accessibility](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0)     | `Dashboard · Editorial · Desktop` (1440px), `Dashboard · Editorial · Mobile` (390px), and accessibility/interaction specifications            |
| [Brand & components](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-2-0)            | `Brand & interface · Editorial system`: approved logo, typography, semantic swatches, action/focus/unavailable specimens and status specimens |
| [Archive · Initial exploration](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-3-0) | Initial desktop exploration, retained for comparison                                                                                          |

The Paper artifacts remain editable design drafts and static component specimens.
A browser-only interactive implementation is now available in `apps/web` at
`/?demo=1`; the existing authenticated integration shell remains at `/`. The facility plan now uses an illustrated architectural SVG with furnished rooms,
shared walls, swinging doors, windows, a corridor, lounge and landscaped grounds.
It is a fictional layout, not a surveyed facility plan or resident-position estimate.
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

| Foreground / background         | Ratio   |
| ------------------------------- | ------- |
| Plum ink / plaster              | 12.82:1 |
| Slate supporting text / plaster | 5.83:1  |
| White / berry button            | 6.68:1  |
| Berry / blush                   | 5.86:1  |
| Sage / pale monitoring surface  | 6.09:1  |
| Border `#807781` / white        | 4.31:1  |

Desktop, mobile, identity and accessibility sheets were visually reviewed in
Paper for hierarchy, spacing, contrast, alignment, wrapping and artboard fit.
The logo import and CSS token export were verified. Browser keyboard behavior,
VoiceOver, zoom/reflow, real focus styles and form errors remain implementation
checks. Sponsor eligibility and award submission requirements were not verified.

## Run and explore the interactive demo

All dashboard tabs share one compact header row containing the title, facility,
demo notice, botanical ornament and scenario controls, with no separate notice
row. The header reflows on narrow screens. A single status strip shows active
incidents, offline devices, room count and last staged data time. The offline
device indicator opens Devices. The sidebar keeps the moonlit logo and landscape,
uses shorter navigation labels, and has no independent scrollbar. At short
desktop heights it scrolls with the page so every navigation item remains reachable.
The botanical header ornament and the existing palette and typography remain.
The workspace fills the browser without an outer framed card, corner rounding or
exterior margins; content keeps internal spacing.

Unacknowledged possible-fall incidents use a burgundy banner, an explicit
"Needs review" badge, a stronger callout heading and a matching primary action.
The active incident count echoes that priority. Acknowledged/responding incidents
use a softer treatment; resolved incidents use a sage header. Monitoring faults
use quieter amber surfaces and an offline icon, including the device indicator
and affected room detail. Status text and symbols distinguish these states in
addition to color. Visual emphasis does not confirm that a fall or injury occurred.

Overview retains the original illustrated facility map beside the selected room's
incident card, with their top edges aligned. The map title and zoom controls sit
over the map; controls stay in place when its illustration scrolls. The map
supports mouse, pen and touch grab-and-drag panning in both directions,
including at 100% zoom, with 240 CSS pixels of canvas beyond each illustration
edge. A fixed viewport keeps zoom from expanding the page. Zoom preserves the
view center; Reset map view restores 100% and the initial map position. A small
movement threshold distinguishes dragging from room selection. Keyboard room
activation, native scrolling and arrow-key panning remain available. Pointer
cancellation and capture loss release the grabbing state. Browser checks cover
dragging across rooms without selecting them, pointer jitter, dragging outside
the viewport, cancellation, reset, zoom anchoring and emulated touch gestures.

The room directory is only in Residents, with aligned room, resident, status and
last-data columns. Device check-in history is only in Devices. Incident detail presents the
next valid lifecycle action, with family notification and timeline details
expandable underneath. This local iteration follows the owner's direction to
stop Paper work; it is not a new Paper export.

At narrow widths the incident appears before the map. The floor plan scrolls
within its own region to preserve readable room labels. Browser checks at 320,
390, 768, 1024, 1280 and 1440 CSS pixels verified no page-level horizontal overflow,
room selection, staged incident actions, contact-dialog access, scenario changes
and navigation. All four tabs also passed shared-shell dimension comparisons at
these widths, including the mobile navigation menu. Desktop checks verify that
the map and incident card are flush at the top, the zoom controls sit inside the
map, and the directory and check-in history appear only in their respective tabs.
These checks use fictional in-memory fixtures, with no provider calls or backend
requests.

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

## Illustrated facility map revision

The [Facility map · Illustrated architecture source](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0/LC-2)
is a 1000×800 drawing with editable room-status overlays. Its scaled version
replaces the previous tile diagram in the desktop Paper dashboard. The same
[SVG source](../design/facility/willow-house.svg) is loaded by
`apps/web/src/dashboard/FacilityMap.tsx`; geometry was read from Paper's computed
styles and overlay JSX rather than inferred from screenshots.

The six room buttons use drawing coordinates normalized to percentages and
remain aligned with the floor plan at 100%, 125% and 150% zoom. The selected room
has a dashed outline; incident, acknowledged/responding and offline states use
text and symbols as well as color. Offline rooms have a hatched overlay. An
incident in Room 104 stays in Room 104; reference-image room labels do not remap
fixture IDs or event associations. Resolving the staged incident clears its alert
overlay while retaining history.

The illustration retains a minimum width of 640 CSS px for legible labels and
scrolls inside its own labeled, keyboard-focusable viewport on small screens.
The rest of the page reflows normally, and the accessible room list remains
available. Zoom controls and room buttons exceed 44×44px. This map does not
introduce an image-generation service, new runtime dependency or data request.

Validation: full `pnpm check` passed (19 tests, types, lint, formatting, contract
generation and production builds). Chrome checks verified all six map selections,
overlay alignment, contained labels, minimum target sizes, zoom limits, Enter
activation, acknowledged/resolved/offline states and absence of page overflow at
1440/1024/768/390/320 CSS px. The prior incident/contact/navigation browser checks
also passed. Paper and browser map screenshots were visually reviewed for
spacing, typography, contrast, alignment and fit.

## Conservatory refinement and restore points

The user requested a modest visual refinement from supplied dashboard, botanical
and Blissey references while retaining healthcare readability. The new Paper
variants are [Dashboard · Conservatory · Desktop](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0/13F-2)
and [Dashboard · Conservatory · Mobile](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0/1EA-2).
The original editorial desktop/mobile boards were duplicated and left intact.

The refinement adds an original SVG botanical medallion, fine heading rules,
rounded workspace/navigation surfaces, subtle panel shadows, stronger summary
labels and an illustrated connectivity ring. The SVG lives in
`design/ornaments/conservatory-branch.svg`. Paper's computed styles and clean JSX
were read before implementation in `refinement.css` and `SummaryCards.tsx`.
The refinement uses the existing palette/type tokens; its variant panel radius is
18px and workspace radius is 28px. Base token values stay intact for comparison.

Botanical artwork is decorative, hidden from assistive technology and omitted on
small screens/forced colors. Operational text, active-incident priority, redundant
status labels/icons, 48px actions, focus behavior and explicit consent/review remain
unchanged. The ring represents the current device count only, never a resident
health score. Its value and offline caption derive from the same room fixtures as
the summary and map. No new sensor activity, clinical status or live call behavior
is inferred. There is no animation or third-party image dependency.

### Compare or restore

- Current default preview: http://localhost:5173/?demo=1 (use Vite's printed port).
- Base-style preview: http://localhost:5173/?demo=1&style=base. This preserves the
  base frontend appearance while using the current code and latest merged backend.
  Changing preview URLs reloads the page and discards in-memory demo edits.
- Exact pre-refinement code: Git tag `dashboard-base-v1`, pointing to `6aa9613`.
  The tag and baseline branch were pushed before design changes.
- Baseline branch: `codex/interactive-paper-dashboard`, pushed at `4cbeea3`, which
  merges latest main `0a3dbfb` while preserving the original dashboard.
- Refinement branch: `codex/dashboard-botanical-refinement`.

To return the checkout to the base after saving any new work:

```sh
git switch codex/interactive-paper-dashboard
```

For an independent exact-tag checkout without changing ongoing work:

```sh
git worktree add --detach ../blissey-dashboard-base dashboard-base-v1
```

Validation: after the latest-main merge, full repository checks passed with 24
tests, formatting, lint, typechecks, generated-contract verification and production
builds. Chrome browser checks passed the existing incident/contact/notification
preview flow, modal keyboard focus, six map selections, zoom and offline states.
Reflow and map geometry passed at 1440/1024/768/390/320 CSS px. Additional checks
covered the base URL, connectivity-ring zero state, no-incident neutral styling
and count/icon separation at 1440/1280/1024/768px. Desktop and mobile incident
views were visually reviewed. Complete WCAG conformance, VoiceOver and hosted
frontend deployment remain unverified. No database migration or live provider
action was performed by this design revision.

## Moonlit logo and reviewed enriched design

The sidebar landscape now sits directly on the sidebar surface: no separate
gradient card or rounded frame. It extends to both sidebar edges and fades into
the lavender surface at the bottom. It remains decorative, ignores pointer input,
and stays hidden on mobile and in forced-color mode.

The current default preview implements the reviewed enriched direction with the
user's supplied Moonlit mascot logo. Paper source:
[Dashboard · Moonlit · Desktop](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0/20L-0)
and [Dashboard · Moonlit · Mobile](https://app.paper.design/file/01M564RV9F6VTR8FYF26BQB6KX/p-1-0/2GB-0).
Earlier editorial, conservatory and enriched boards are retained unchanged.

The default logo uses `design/brand/blissey-beacon-moonlit-mark.png`, copied
unchanged from the user's transparent PNG. Its alpha channel removes the original
wordmark too, so Paper and React supply separate DM Sans lettering: “blissey”
at 32px/36px, weight 800, and “beacon” at 14px/20px, weight 600. The mascot sits
above the text on desktop and beside it on mobile (28px/32px main lettering).
Both parts have transparent backgrounds. The home link has one accessible name;
the image has empty alt text to avoid duplicate announcements. Layout frames
exclude unused transparent space without modifying the image. The full original
`blissey-beacon-moonlit.png` remains as a reference. No image was regenerated or
retouched.

Transparent-wordmark follow-up validation: web TypeScript/production build passed;
Chrome verified the source alpha, editable lettering, single accessible home-link
name and no page overflow at 1440/1024/390/320px. Paper desktop/mobile wordmark
screenshots and the implemented mobile header were visually reviewed.

Seven additive Paper color tokens are exported in
`design/brand/moonlit-tokens.css`. The Moonlit root maps these to the existing
semantic roles: dark plum ink, darker dusty rose controls, pale pink surfaces and
a light lavender sidebar. Sage monitoring and amber warning semantics are retained.
Global original tokens remain intact for earlier themes. Summary counts use DM
Sans with tabular numerals; display headings retain Instrument Serif. The source
SVG hills, background shapes and sensing arcs were read directly from Paper JSX
and implemented as decorative, assistive-technology-hidden geometry.

The enriched sensor-history panel was corrected before implementation:

- Replace the implication that a reconnected device makes a room safe with explicit
  monitoring-unavailable and resident-condition-unconfirmed text.
- Label the 12-hour display as sample check-ins, with visible 03:00/09:00/14:00
  labels and an accessible table containing all 12 column headers, room row headers
  and reported/no-report cell text.
- Keep fixed historical illustration data separate from current connection counts.
  The table uses fictional October 17, 2026 reports, not device or patient telemetry.
- Use a flowing right column rather than absolute card placement. At narrow widths,
  the incident comes first, then the room list/map, then optional history.

Public entry points: `/` opens the approved Moonlit demo by default; `/?demo=1`
remains compatible. The sidebar's operator link opens `/?operator=1`, preserving
Supabase Auth and the existing live integration shell. `/?demo=0` is also accepted
for the operator shell. The public dashboard continues to show fictional-data
labels and makes no operator/provider requests.

Preview variants (use Vite's printed port): default `/` or `/?demo=1` for Moonlit,
`/?demo=1&style=conservatory` for the previous conservatory revision, and
`/?demo=1&style=base` for the editorial base. Git tag `dashboard-base-v1` and the
previous pushed branch remain intact. The Moonlit work uses
`codex/moonlit-brand-and-health-panel`.

Validation: full repository checks passed with 24 tests, lint, formatting, types,
generated-contract verification and production builds. Browser regression checks
passed incident actions, consent/review gates, keyboard focus, all six map
selections, zoom and service isolation. Additional Chrome checks verified the
new logo decodes at 1254×1254, all 72 sample cells and 12 time columns, current
connection counts, restored prior styles and priority ordering/no page overflow at
1440/1280/1024/768/390/320 CSS px. Contrast ratios: white/primary 6.17:1, muted/canvas
5.73:1, ink/canvas 10.01:1, light panel text/plum 7.85:1, chart dots/plum 5.84:1 and
input boundaries/white 3.97:1. Paper and browser desktop/mobile screenshots were
reviewed. Formal WCAG conformance, VoiceOver and hosted rollout remain unverified.
No live call, database migration or model/provider request was performed.
