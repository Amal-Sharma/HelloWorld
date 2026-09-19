# Hello World Universe Explorer

A React, TypeScript, and Three.js explorer with one continuous, Sun-centered Galactic map. Planets, stars, comets, nebulae, and galaxies share metric coordinates; detailed models load automatically as the camera approaches them.

## Run

Requires Node 22+ and a WebGL 2-capable browser.

```sh
npm install
npm run dev -- --host 127.0.0.1
```

Vite prints the local URL, normally http://127.0.0.1:5173. Catalog snapshots and planetary textures are served locally. No API key is needed.

## Deploy To GitHub Pages

In the repository's **Settings > Pages > Build and deployment**, set **Source** to **GitHub Actions**. Commit and push the deployment changes to `main`. The [deployment workflow](.github/workflows/deploy-pages.yml) installs dependencies, runs unit tests and lint, builds the app for the repository subdirectory, and verifies desktop/mobile rendering before publishing `dist`.

The site URL is https://amal-sharma.github.io/HelloWorld/. Check the **Actions** tab for the deployment result. Later pushes to `main` redeploy automatically; **Run workflow** also allows a manual deployment.

Do not publish the raw `main` branch root: its HTML references TypeScript source that browsers cannot run directly. Keep `dist` ignored by Git; the workflow uploads the generated build as a Pages artifact. No personal token is stored in the workflow. When pushing a workflow file with a fine-grained personal access token, GitHub requires **Workflows: Read and write** in addition to **Contents: Read and write** for this repository.

To check the same project-path build locally:

```sh
DEPLOY_BASE_PATH=/HelloWorld/ npm run test:e2e -- --grep 'deployment assets'
```

Set `PREVIEW_PORT` to an unused port if the default test port, 4179, is busy. For a custom domain hosted at its root, set the workflow's `DEPLOY_BASE_PATH` to `/`.

## Map Navigation

- Navigate with scrolling, dragging, pinching, or WASD without selecting any destination. Catalog entries and markers remain optional fly-to shortcuts.
- Drag to orbit; right-drag to pan. The hand control swaps the primary drag mode.
- Selecting a body enables Follow. Wheel zoom, pinch zoom, camera rotation, and simulation-time changes preserve that body's center instead of snapping to the Sun or another marker. Release Follow with the target toggle, or pan/use WASD to return to free movement.
- Scroll or pinch to zoom continuously from planetary to intergalactic distances. Hovering a label and scrolling inward approaches that body's position without selecting it. On touchscreens, use two fingers to pan and zoom.
- In map mode, use WASD to travel, Q/E to move down/up, and Shift to move faster.
- The continuous scale slider changes the camera's distance logarithmically; it never switches maps. Live readouts show region, nearest object, view span, and Sun-centered Galactic XYZ coordinates in parsecs.
- Close-up and Orbit views remain available. Orbit is enabled only where positions can be computed.
- The **Orbits** switch controls solar-system paths independently of the **Labels** switch, which shows or hides object names. Both settings are also available under Display settings. Map paths appear at appropriate solar-system and moon-system scales; they are not drawn across galaxy-scale views. Press **O** to toggle paths, including while the UI is hidden.
- In the continuous **3D map**, the orbit layer includes all usable catalog paths: eight planets, seven cataloged moons around their parent planets, five dwarf planets, thousands of asteroids and comets, and Voyager/New Horizons trajectory segments. Minor-body paths build incrementally and share three GPU batches. Background tracks are faint; the selected minor body's path is brighter and more finely sampled. Buffers are reused when toggling the layer and hidden when leaving the solar neighborhood. Objects with missing or invalid orbital data receive no invented path. This is catalog coverage, not a claim to include every object in the real Solar System; the Sun is the heliocentric reference, not given a fictitious solar orbit.
- Use the crossed-eye **Hide UI** camera button or press **H** for a clean view with no panels or object names. The eye button at the bottom right, **H**, or **Escape** restores the interface. Rotation, zoom, movement, and Follow remain active; the camera position and your orbit/name preferences are preserved. Clean view is independent of browser fullscreen, and rendering errors remain visible.
- **Display settings > Milky Way style** switches between **Reference**, the screenshot-inspired visual trial, and **Original**, the previous particle galaxy. Reference emphasizes the galaxy's overall light and 3D shape: a luminous cream-gold central bulge, blue-gray arm light, and a thin outer disk around a rounded stellar center. Diffuse light is blended to retain its color; when entering the disk, unresolved haze fades while brighter star cores retain detail. It does not add star flares. Original retains its existing colors, positions, and glow. Switching is immediate, preserves the camera and Follow target, and saves the choice in this browser. Reference is the initial trial default; select Original to keep the earlier appearance.
- Space pauses time, R resets the camera, and / focuses search. Text fields retain normal keyboard behavior.
- Saved destinations persist in local storage. The camera button exports the 3D scene as a PNG.
- The camera toolbar includes Enter fullscreen on desktop and phones. Use Exit fullscreen or the browser's exit gesture (such as Escape) to return; the button stays synchronized with the browser. Browsers that block or do not support the Fullscreen API show a notice without interrupting exploration.
- **Adaptive rendering** in Display settings reduces the pixel ratio to 70% during camera movement (about half the pixel workload), then restores full quality after the camera settles. Models and coordinates are unchanged, and image exports use full quality. Disable it to keep constant resolution. This reduces rendering work but is not a guaranteed frame rate on every device.
- The **Distance ruler** camera button opens two searchable endpoints in the 3D map. Distances and one-way light times update with the simulation date. The frame button fits both endpoints and releases Follow; swap and clear controls do not change the camera. Kilometers, AU, and light-years are chosen according to scale. Clean view hides the ruler without discarding its endpoints.
- **Galactic dust** in Display settings is a reversible Reference-style trial. It attenuates starlight passing through a thin, warped, artwork-aligned dust volume rather than placing an opaque surface over the galaxy. Turning it off restores the dust-free render; Original mode bypasses it. Sampling drops from eight to four steps during adaptive navigation or low-quality rendering.

## Exploration Tools

The **Tools** button opens a responsive panel without replacing the main 3D canvas.

- **Views:** save up to 30 named viewpoints locally or generate a share link. Snapshots preserve camera position/target/up, field of view, date, view mode and visual layers. Map cameras are stored in world parsecs, not floating render coordinates. Comparison body choices and observer location are included for those modes. Loading pauses time and releases Follow to preserve the saved viewpoint. Invalid versions, vectors, dates and unavailable comparison bodies are rejected; links contain no account credentials or uploaded data.
- **Scale:** choose three catalog bodies with reference radii and show them side by side at one linear physical scale. Small objects remain small, including subpixel cases. Black-hole sizes refer to inferred non-spinning horizon radii, not accretion disks; star sizes are estimates. Surface lighting and spacing are illustrative. Nominal rogue-planet and spacecraft radii are excluded.
- **Sky:** enter latitude, longitude and elevation or choose a city preset. Astronomy Engine supplies topocentric Sun, Moon and planet positions with standard refraction; HYG stars are transformed to the local horizon. Rotate to look around and zoom the field of view. Optional constellation names identify IAU regions, not measured connecting lines. Star markers are visibility-enhanced; daylight dimming, weather-free atmosphere, and sky colors are illustrative. No geolocation permission is requested.
- **Events:** find the next local solar eclipse, lunar eclipse, Mercury transit and Venus transit within the 1900-2100 simulation range. Jump to the event and use Start/Peak/End controls to inspect contacts. The Sun, Moon and transit silhouettes use calculated apparent angular sizes. Solar obscuration dims the sky; the corona is illustrative. Lunar eclipses use an ephemeris-derived Earth shadow with illustrative red tint. Horizon visibility is stated; transit contact times are geocentric and can differ from local contacts. Never use the app as a substitute for certified solar-viewing protection.
- **Missions:** scrub the bounded Horizons history of Voyager 1, Voyager 2 or New Horizons and jump to reference encounters. Trajectories remain open and never extrapolate beyond the stored interval. NASA VTAD spacecraft models are bundled locally; attitude is illustrative. The timeline starts shortly after launch, so it does not reconstruct launch/parking-orbit operations.
- **Scientific confidence:** the object inspector separately labels position method, size basis, classification certainty and appearance source. These are provenance categories, not statistical probabilities or guarantees of accuracy.
- **Planet detail:** Saturn receives analytic planet-on-ring and ring-on-planet shadows. Atmosphere shells use directional, Rayleigh/Mie-inspired light rather than uniform rim glow. Lighting remains an illustrative inspection setup, not a date-correct global atmospheric radiative-transfer model. Titan and Enceladus add NASA-derived surface maps and Saturn-centered approximate Kepler motion.

## Catalog Coverage

The app contains 135,156 entries: 85 curated destinations plus the September 16, 2026 source snapshots below. The curated catalog includes the Galilean moons, Titan, Enceladus, Voyager 1 and 2, New Horizons, isolated planetary-mass candidates, stellar and supermassive black holes, nebulae, supernova remnants, galaxy clusters, and the Bootes Void.

Additional destinations include PSO J318.5-22, WISE 0855-0714, Gaia BH1 and BH3, V404 Cygni, the central black holes of Centaurus A and NGC 1275, NGC 1275 itself, the Pillars of Creation, Cat's Eye, Butterfly and Bubble nebulae, the Tycho, Kepler, SN 1006 and Vela remnants, the Bootes Void, three spacecraft, Titan and Enceladus. All use the existing shared coordinate frame. Black-hole nuclei share their host galaxies' centers; voids have no solid collision boundary.

| Source | Imported Entries |
| --- | ---: |
| HYG v4.1 stars | 119,625 |
| NASA confirmed exoplanets (PSCompPars) | 6,366 |
| JPL SBDB comets | 4,076 |
| JPL minor planets, including all five dwarf planets | 5,004 |

The exoplanet and comet snapshots include all rows returned by those queries. Minor planets include the top 5,000 by cataloged diameter plus four explicit dwarf-planet lookups, ensuring all five recognized dwarf planets are present. This is not every known object in the Milky Way. Catalogs are incomplete, and some objects lack reliable distances or usable orbital solutions.

109,400 HYG stars have usable distances and are eligible for 3D placement. Unknown distances are never replaced with invented coordinates. Exoplanet markers use host-star positions; planetary surfaces, phase, and full orbital orientation are generally unknown.

Refresh snapshots with `npm run sync:catalog`. The importer records source URLs and retrieval time in `public/data`. It requires internet access and does not run automatically during builds.

Spacecraft positions come from NASA/JPL Horizons geometric heliocentric J2000 ecliptic vectors in AU. Voyager 1 starts at 1977-09-06, Voyager 2 at 1977-08-21, and New Horizons at 2006-01-20; all snapshots end at 2030-01-01 UTC. At most four-day background intervals are supplemented by hourly samples within two days of the principal flybys. The app linearly interpolates and never extrapolates or closes these escape trajectories. Refresh the per-spacecraft JSON modules and self-contained NASA GLBs with `npm run sync:spacecraft`.

Titan and Enceladus use JPL Horizons Saturn-centered osculating elements at 2026-09-16 TDB, including their satellite-specific mean motions. These are approximate two-body orbits; omitted perturbations and precession cause errors away from the epoch. Refresh their data and NASA-derived textures with `npm run sync:saturn-moons`. That optional importer extracts the official model's base-color texture and resizes it to at most 2048 x 1024 using Sharp; it does not run during normal builds.

The Pillars particle asset can be regenerated with `npm run sync:nebula`. The importer uses Three.js's STLLoader and MeshSurfaceSampler on NASA's full printable reconstruction, removes the lower printing pedestal/basal support section (26% of original height), converts to Y-up coordinates, and uniformly scales 48,000 area-weighted samples. The full STL is only downloaded during this optional conversion; the browser loads the derived ~1.2 MB JSON asset on demand. Neither NASA assets nor catalog snapshots are fetched from external servers during normal use.

## Scientific Limits

- The ruler reports instantaneous center-to-center separation in the shared map frame and light time as distance divided by 299,792.458 km/s. It is not a signal-interception calculation, surface clearance, or a relativistic/cosmological travel-time solver. Extended objects use approximate reference centers; exoplanets use host-star coordinates. Unknown distances, unsupported spacecraft dates, and aggregate destinations without a unique position produce an unavailable result, never invented coordinates. At extragalactic scales the displayed light time ignores cosmic expansion and is not a lookback time.
- The dust trial is illustrative extinction, not a measured Milky Way dust survey or a full scattering simulation. Its planar density guide comes from the existing NASA artist's concept, with a modeled vertical thickness and warp. Bounded line-of-sight samples dim and preferentially redden obscured galaxy particles; catalog coordinates, other galaxies, and Original mode are unaffected.
- Spacecraft attitude, lighting and extent are illustrative; Horizons snapshots are not live telemetry and are only valid over their documented mission-specific interval. The broader simulation's 1900-2100 controls do not extend that coverage.
- PSO J318.5-22 and WISE 0855-0714 are isolated substellar objects whose estimated masses overlap the planetary range. Their formation histories are uncertain; they are not presented as confirmed ejected planets. Their visible surfaces, infrared-inspired cloud colors and nominal radii are illustrative. No host stars, orbital periods or closed paths are invented, and proper motion is not propagated.
- Gaia BH1 and BH3 are rendered without luminous accretion disks or jets. Their dark shadows and illustrative background starlight use the existing approximate non-spinning ray integrator. Active stellar and supermassive systems show illustrative accretion states; inferred Schwarzschild radii use approximate masses, not measured solid surfaces.
- The Bootes Void (the Great Void/Great Nothing) is an approximate 100 Mpc-wide underdensity centered about 215 Mpc away, near RA 14h50m, Dec +46 degrees. Its extent depends on the definition used. The interior is sparse, not empty; the drawn galaxy distribution and surrounding filaments are schematic, not individually identified survey galaxies. It is not a black hole and has no single orbit.
- The Pillars geometry comes from a NASA-hosted STScI reconstruction adapted from a print model, not a measured gas-density volume. Rendering colors and diffuse emission are illustrative. Other new nebulae and remnants use source-informed bipolar, shell or filamentary morphology with enhanced spectral colors and approximate depth.
- Astronomy Engine calculates planetary, lunar, and Galilean-moon positions for the selected date. Io, Europa, Ganymede, and Callisto use Jupiter-relative ephemerides combined with Jupiter's heliocentric position. Their orbit view is centered on Jupiter. The UI supports 1900-2100.
- JPL small-body osculating elements are propagated with Astronomia's Kepler and near-parabolic solvers. These are approximate two-body trajectories, not JPL Horizons ephemerides. Planetary perturbations and comet outgassing are omitted.
- Minor-body path lines show their snapshot osculating conics, not long-term N-body predictions. Elliptical paths close; parabolic and hyperbolic escape paths remain open and are clipped at the greater of 10,000 AU or four perihelion distances. Lower-resolution background paths approximate these curves; the selected body's finer path uses the same orbital elements. Spacecraft paths retain their bounded mission-specific coverage.
- HYG coordinates refer to J2000 and are transformed to Galactic coordinates. Proper motion is not propagated.
- Map mode uses one Sun-centered Galactic coordinate frame in parsecs, with planetary ephemerides rotated into that frame. A floating render origin and scale keep GPU coordinates local without changing world distances. Distant extended objects are projected at the same angular size into the rendering range. The same world remains loaded while you zoom between scales.
- Bodies with published radii use those radii in map mode. Point markers are visibility-enhanced, and unknown stellar radii are illustrative. The separate close-up and orbit inspection views retain illustrative display scales.
- Nebula and external-galaxy placements use approximate catalog directions and reference distances; these are not precise surveyed 3D volumes. The cosmic web remains schematic. Objects without reliable distances are not given invented map positions.
- The Milky Way's bulk structure, nebulae, jets, cosmic web, and black-hole lensing are artistic reconstructions. Background particles do not each represent an identified object.
- Black-hole light paths use bounded, approximate non-spinning ray integration through an illustrative thin accretion disk. Plasma emission, color shifts, the photon-ring glow, and jets are simplified; this is not a full relativistic accretion model.
- Animated black-hole features represent accreting gas and outward jet pulses, not a visible spinning solid surface or measured black-hole spin. Jets are shown for quasars and M87*, not every black hole. Solar granulation, prominence loops, and plasma ejections are artistic, time-scaled effects; they are not a live solar-weather feed. These effects pause with simulation playback.
- Galilean-moon surface patterns are procedural illustrations; Titan and Enceladus use maps derived from NASA VTAD models, with illustrative orientation and lighting. Added extended objects have approximate reference distances, sky coordinates, sizes, and shapes rather than reconstructed three-dimensional survey volumes.
- The Milky Way is rendered as glowing 3D particles, without a flat image surface. The credited NASA artist's concept guides particle density and color; a warped disk, thick stellar population, central bulge, and sparse halo supply depth. Each star has a luminous core and soft halo, with particle-based diffuse light and view-dependent exposure to keep overlapping stars from washing out. These particles are illustrative, not individually identified stars; measured HYG markers remain a separate catalog layer.
- The optional Reference galaxy style interprets user-supplied screenshots; it does not import their assets or claim a new scientific reconstruction. Its added central stars, color distribution, diffuse emission, thinner outer disk and ellipsoidal bulge are illustrative. All measured catalog coordinates and other galaxies are unchanged, and the Original rendering is retained for comparison.
- Exoplanet parameters are composite source values and may come from different references. Missing values remain unavailable.

## Attribution

- Voyager geometry: [NASA VTAD Voyager 3D model](https://science.nasa.gov/resource/voyager-3d-model/). The self-contained GLB is bundled locally; display scale, attitude and lighting are adapted. Positions: [NASA/JPL Horizons](https://ssd.jpl.nasa.gov/horizons/); the snapshot includes exact API queries, frame, units and retrieval time. NASA assets follow the [NASA media-use guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/); no endorsement is implied.
- New Horizons geometry: [NASA VTAD New Horizons model](https://science.nasa.gov/resource/new-horizons-3d-model/). Moon texture sources: [NASA VTAD Titan model](https://science.nasa.gov/resource/titan-3d-model/) and [Enceladus model](https://science.nasa.gov/resource/enceladus-3d-model/), with base-color maps extracted and resized for browser use. Orbital elements and mission trajectories: NASA/JPL Horizons. Milestone dates link to their NASA mission histories; they are reference encounter times, not navigation-grade solutions.
- Observer coordinates, constellation membership, eclipse and transit predictions: [Astronomy Engine](https://github.com/cosinekitty/astronomy). The sky uses the credited HYG stellar snapshot; proper motion is not propagated. The favicon is generated from the existing Lucide Orbit icon.
- Pillars geometry: [NASA 3D Resources / Pillars of Creation](https://science.nasa.gov/3d-resources/pillars-of-creation/), by Leah Hustak and Ralf Crawford, Space Telescope Science Institute. Derived by removing the print pedestal/basal support, reorienting/scaling and surface sampling; added colors and particle emission are illustrative.
- New compact-object, nebula and remnant directions: [CDS SIMBAD](https://simbad.cds.unistra.fr/simbad/), queried in September 2026; coordinate links are included in object details. Distances and radii are approximate reference values. Gaia BH3: [ESO / Gaia Collaboration](https://www.eso.org/public/news/eso2408/). Void context: [NASA large-scale structures](https://science.nasa.gov/universe/galaxies/large-scale-structures/), with approximate Bootes extent and center following the [Bootes void survey](https://ui.adsabs.harvard.edu/abs/1987ApJ...314..493K/abstract).
- Planet maps: [Solar System Scope / INOVE](https://www.solarsystemscope.com/textures/), based on NASA imagery, under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Rendered with simulated lighting and sphere projection.
- Milky Way illustration: [NASA/JPL-Caltech, PIA10748](https://science.nasa.gov/photojournal/our-milky-way-gets-a-makeover-artist-concept/), courtesy NASA/JPL-Caltech, reused under the [JPL image use policy](https://www.jpl.nasa.gov/jpl-image-use-policy/). The local image is resized to 2048 pixels and sampled for the density and color of a volumetric particle galaxy; the image itself is not displayed as a galaxy surface. No NASA/JPL endorsement is implied. Visual reference supplied by the user: [Universe Today Milky Way illustration](https://www.universetoday.com/article_images/milky_way.jpg).
- Star data: [HYG v4.1, David Nash / Astronomy Nexus](https://github.com/astronexus/HYG-Database/tree/main/hyg), under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The derived `public/data/stars.json` retains that license. Changes: selected columns, aliases, missing-distance handling, and conversion from equatorial to Galactic coordinates.
- Confirmed planets: [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/), PSCompPars table.
- Small bodies: [NASA/JPL Small-Body Database](https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html).
- Physical reference values: NASA Science links provided per object.
- The supplied Scientific American / Mark Garlick and Star Name Registry black-hole images were used only as visual references. Their copyrighted images are not distributed with the app. Disk, jet, and solar-effect geometry and shaders are generated by Hello World.

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

Playwright checks canvas pixels and screenshots, textures, continuous zoom between astronomical scales without selection, automatic planetary detail on approach, map reuse, camera controls, catalog selection, imported bookmarks, date-driven motion, image export, and mobile layouts. Follow is tested with mouse wheel, button zoom, rotation, real two-touch pinch input, time changes, and release. Visual tests cover moving solar plasma and black-hole accretion flows. Stability regressions cover repeated WebGL context loss and restoration, hidden-tab suspension, repeated view changes, failed and malformed catalog responses, unavailable comet trajectories, and extreme zoom. Artifacts are written to `test-results`.

Branding and fullscreen checks cover desktop and 390px/320px phone layouts, native fullscreen entry and exit, browser-initiated exits, denied fullscreen requests, and nonblank rendering.

New-destination checks cover NASA model loading on desktop/mobile under the GitHub Pages base path, shared-map travel between all new object families, real Voyager distance and bounded interpolation, invalid-date recovery, dormant versus active black holes, nebula clipping limits, and entering the void without a collision wall. Optional asset importers validate downloaded geometry and ephemeris payloads before writing derived files.

Science-tool tests cover viewpoint validation and exact restore, shared observer/comparison parameters, physical radius ratios, known solar/lunar eclipse and Mercury-transit dates, event contact navigation, historical spacecraft samples, Saturn-relative moon positions and periods, NASA textures, and desktop/390px/320px framing. Saved views pause time and preserve world coordinates rather than projected camera units.

Lint uses ESLint's TypeScript checks and the official React hook rules, including React 19 effect events. The lint command fails on warnings. The renderer, Three.js core, and controls have separate production chunks.
