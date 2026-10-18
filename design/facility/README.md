# Willow House floor plan

`willow-house.svg` is original code-drawn vector artwork for the fictional demo,
created using the user's supplied architectural-map reference for visual direction.
It contains no embedded photograph, screenshot, resident data or network resource.
The editable Paper source is linked in [the frontend handoff](../../docs/frontend-design.md#illustrated-facility-map-revision).

The drawing uses a 1000×800 viewBox. Clickable room interiors are 199×209 drawing
units, starting at (108,78), (323,78), (538,78), (108,438), (323,438), (538,438),
for rooms 101–106. Furniture, doors and landscaping are illustrative. They do not
represent sensor localization, a surveyed floor plan or evacuation instructions.

The application loads this SVG as a decorative image and supplies native HTML
buttons for labels, state and interaction. Do not bake incident state into the
artwork; the same room model drives map overlays and the accessible room list.
