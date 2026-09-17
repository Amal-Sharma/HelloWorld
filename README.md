# ATLAS Universe Explorer

A React, TypeScript, and Three.js explorer with one continuous, Sun-centered Galactic map. Planets, stars, comets, nebulae, and galaxies share metric coordinates; detailed models load automatically as the camera approaches them.

## Run

Requires Node 22+ and a WebGL 2-capable browser.

```sh
npm install
npm run dev -- --host 127.0.0.1
```

Vite prints the local URL, normally http://127.0.0.1:5173. Catalog snapshots and planetary textures are served locally. No API key is needed.

## Map Navigation

- Navigate with scrolling, dragging, pinching, or WASD without selecting any destination. Catalog entries and markers remain optional fly-to shortcuts.
- Drag to orbit; right-drag to pan. The hand control swaps the primary drag mode.
- Scroll or pinch to zoom continuously from planetary to intergalactic distances. Hovering a label and scrolling inward approaches that body's position without selecting it. On touchscreens, use two fingers to pan and zoom.
- In map mode, use WASD to travel, Q/E to move down/up, and Shift to move faster.
- The continuous scale slider changes the camera's distance logarithmically; it never switches maps. Live readouts show region, nearest object, view span, and Sun-centered Galactic XYZ coordinates in parsecs.
- Close-up and Orbit views remain available. Orbit is enabled only where positions can be computed.
- Space pauses time, R resets the camera, and / focuses search. Text fields retain normal keyboard behavior.
- Saved destinations persist in local storage. The camera button exports the 3D scene as a PNG.

## Catalog Coverage

The September 16, 2026 snapshot contains 135,106 entries, including 35 curated destinations and:

| Source | Imported Entries |
| --- | ---: |
| HYG v4.1 stars | 119,625 |
| NASA confirmed exoplanets (PSCompPars) | 6,366 |
| JPL SBDB comets | 4,076 |
| JPL minor planets, including all five dwarf planets | 5,004 |

The exoplanet and comet snapshots include all rows returned by those queries. Minor planets include the top 5,000 by cataloged diameter plus four explicit dwarf-planet lookups, ensuring all five recognized dwarf planets are present. This is not every known object in the Milky Way. Catalogs are incomplete, and some objects lack reliable distances or usable orbital solutions.

109,400 HYG stars have usable distances and are eligible for 3D placement. Unknown distances are never replaced with invented coordinates. Exoplanet markers use host-star positions; planetary surfaces, phase, and full orbital orientation are generally unknown.

Refresh snapshots with `npm run sync:catalog`. The importer records source URLs and retrieval time in `public/data`. It requires internet access and does not run automatically during builds.

## Scientific Limits

- Astronomy Engine calculates planetary and lunar positions for the selected date. The UI supports 1900-2100.
- JPL small-body osculating elements are propagated with Astronomia's Kepler and near-parabolic solvers. These are approximate two-body trajectories, not JPL Horizons ephemerides. Planetary perturbations and comet outgassing are omitted.
- HYG coordinates refer to J2000 and are transformed to Galactic coordinates. Proper motion is not propagated.
- Map mode uses one Sun-centered Galactic coordinate frame in parsecs, with planetary ephemerides rotated into that frame. A floating render origin and scale keep GPU coordinates local without changing world distances. Distant extended objects are projected at the same angular size into the rendering range. The same world remains loaded while you zoom between scales.
- Bodies with published radii use those radii in map mode. Point markers are visibility-enhanced, and unknown stellar radii are illustrative. The separate close-up and orbit inspection views retain illustrative display scales.
- Nebula and external-galaxy placements use approximate catalog directions and reference distances; these are not precise surveyed 3D volumes. The cosmic web remains schematic. Objects without reliable distances are not given invented map positions.
- The Milky Way's bulk structure, nebulae, jets, cosmic web, and black-hole lensing are artistic reconstructions. Background particles do not each represent an identified object.
- Black-hole light paths use bounded, approximate non-spinning ray integration through an illustrative thin accretion disk. Plasma emission, color shifts, the photon-ring glow, and jets are simplified; this is not a full relativistic accretion model.
- The Milky Way's diffuse light uses a credited NASA artist's concept, not an exterior photograph. Its 3D stellar volume is sampled from the illustration; measured HYG markers remain a separate catalog layer.
- Exoplanet parameters are composite source values and may come from different references. Missing values remain unavailable.

## Attribution

- Planet maps: [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), based on NASA imagery, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rendered with simulated lighting and sphere projection.
- Milky Way illustration: [NASA/JPL-Caltech, PIA10748](https://science.nasa.gov/photojournal/our-milky-way-gets-a-makeover-artist-concept/), courtesy NASA/JPL-Caltech, reused under the [JPL image use policy](https://www.jpl.nasa.gov/jpl-image-use-policy/). The local image is resized to 2048 pixels and adapted into a warped, layered 3D disk. No NASA/JPL endorsement is implied. Visual reference supplied by the user: [Universe Today Milky Way illustration](https://www.universetoday.com/article_images/milky_way.jpg).
- Star data: [HYG v4.1, David Nash / Astronomy Nexus](https://github.com/astronexus/HYG-Database/tree/main/hyg), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The derived `public/data/stars.json` retains that license. Changes: selected columns, aliases, missing-distance handling, and conversion from equatorial to Galactic coordinates.
- Confirmed planets: [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), PSCompPars table.
- Small bodies: [NASA/JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html).
- Physical reference values: NASA Science links provided per object.

## Recovery And Stability

- If the browser restores a lost WebGL context, rendering resumes automatically with the same camera and selected object. Rendering stops while the context is unavailable; reload remains a fallback if the browser cannot restore it.
- Hidden tabs suspend rendering and simulation-time updates. Movement keys and inertia are cleared on focus loss so returning to the app does not continue an old movement gesture.
- Catalog requests have a 20-second timeout and one automatic retry. The catalog footer offers an in-place retry after a failure; the curated map remains available. Snapshots are validated and published together, avoiding partially initialized data.
- Navigation requested before an imported object finishes loading waits for its map entry. A comet with an unavailable orbital solution is hidden and tracking stops without changing the camera to invalid coordinates.
- New manual navigation cancels unresolved startup destinations, so a late catalog response cannot redirect the camera. Repeated absolute scale-slider requests use the latest distance instead of compounding an earlier flight.
- View URLs preserve map, close-up, and valid orbit views across reloads. Keyboard shortcuts are isolated from dialogs, and Escape closes a focused search panel.

## Verify

```sh
npm run test
npm run build
npm run lint
npx playwright install chromium
npm run test:e2e
```

Playwright checks canvas pixels and screenshots, textures, continuous zoom between astronomical scales without selection, automatic planetary detail on approach, map reuse, camera controls, catalog selection, imported bookmarks, date-driven motion, image export, and mobile layouts. Stability regressions cover repeated WebGL context loss and restoration, hidden-tab suspension, repeated view changes, failed and malformed catalog responses, unavailable comet trajectories, and extreme zoom. Artifacts are written to `test-results`.

Lint uses ESLint's TypeScript checks and the official React hook rules, including React 19 effect events. The lint command fails on warnings. The renderer, Three.js core, and controls have separate production chunks.
