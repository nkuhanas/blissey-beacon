# Blissey Beacon identity assets

- `blissey-beacon-logo-v1.png`: user-approved logo concept, transparent PNG,
  1774×887. This is raster artwork, not an SVG or editable wordmark.
- `tokens.css`: 36 tokens exported from the Paper document; not loaded into the
  production application yet.
- [Paper source and frontend handoff](../../docs/frontend-design.md).

The logo was generated with the built-in image generation tool (not the CLI),
reviewed in conversation, approved by the user, copied into this repository, and
imported into Paper. No additional image generation or raster edits were used
for the editorial dashboard update. Native Paper typography uses Instrument
Serif and DM Sans; the logo lettering is part of the generated image.

## Original generation prompt

```text
Use case: logo-brand.
Create one polished logo concept for "blissey beacon", a camera-free senior-living monitoring dashboard. This is a usable transparent-background logo asset, not a mockup or brand presentation.
Composition: generous clear space around a single horizontal lockup: distinctive compact symbol on the left, "blissey beacon" in two impeccably aligned stacked lowercase lines on the right. Symbol about the same height as both lines of type. Clearly readable at app-header size.
Design direction: stylish, quietly expressive, warm and trustworthy. An elegant custom rounded lowercase b monogram integrating a subtle heart-shaped counter and a restrained beacon / radiating signal gesture. Resolve it into ONE simple memorable silhouette with excellent optical balance and deliberate negative space; no collection of separate icons. A slight upward beacon accent may use blush pink. Sophisticated geometric curves, precise flat vector-like edges, professional identity-design quality.
Typography: contemporary custom geometric sans wordmark, medium-to-semibold weight, open counters, carefully balanced kerning, subtly distinctive letterforms; not overly bubbly. Exact text "blissey" above "beacon", all lowercase, no other text.
Palette: symbol rich berry #963D63 with restrained blush #D6A1B8 accent; wordmark deep plum #352B34. Flat solid colors. Actual transparent alpha background.
Constraints: no tagline, no medical cross, no ECG line, no shield, no camera, no roof-and-heart clipart, no Pokemon character or other mascot, no gradients, no 3D, no drop shadows, no texture, no background panel, no border, no watermark. This should feel like a refined memorable technology-and-care brand, and remain legible in one-color reproduction.
```

## User-supplied Moonlit identity

`blissey-beacon-moonlit.png` is the complete user-supplied
`Blissey_Beacon__Dreamy_Moonlit_Mascot_Logo.png`, copied unchanged (RGB,1254×1254).
It is the current default demo logo.

`blissey-beacon-moonlit-mark.png` is the supplied
`Firefly_RemoveBackground.png`, copied unchanged (RGBA,1254×1254). The visible
alpha bounds stop at y=875, excluding the wordmark; retain it as a mascot-only
source rather than presenting it as the complete logo. Neither image was generated
or modified by this implementation. The earlier generated logo remains for saved
themes. `moonlit-tokens.css` is the additive CSS export from Paper.
