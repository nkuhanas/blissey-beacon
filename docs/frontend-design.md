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

These are editable design drafts and static component specimens, not a clickable
prototype or implemented application. The facility plan remains schematic; the
detailed architectural illustration in the supplied reference is not complete.
Full sign-in, room/incident detail, contact editing, notification review and all
failure-state screens still need design completion and implementation.

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
token tool. It is a design reference and is not imported by the current app.
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
