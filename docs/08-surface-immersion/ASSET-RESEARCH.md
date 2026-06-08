# Asset Research — NASA 3D models for the lunar surface

Research conducted 2026-06-08 against the three references the user supplied.

## Sources evaluated

1. `https://github.com/ArtechFuz3D/NASA-3D-Model-Viewer` (repo)
2. `https://artechfuz3d.github.io/NASA-3D-Model-Viewer/` (live site)
3. `https://github.com/nasa/NASA-3D-Resources` (repo)

## Bottom line

- **`nasa/NASA-3D-Resources` is the real source.** Newer models already ship as
  **web-ready `.glb`** with embedded textures — fetch straight from
  `raw.githubusercontent.com`, no conversion. (Verified: raw URLs return real
  binary GLB, HTTP 200, `application/octet-stream`.)
- **The ArtechFuz3D repo/site is just a viewer, not a host.** Its `fetchNASAModels()`
  hits the GitHub API and builds the same `raw.githubusercontent.com/nasa/...` URLs
  at runtime. It's vanilla Three.js (not R3F) and stores no GLBs of its own. Value
  to us = **a preview gallery** to eyeball models before downloading from NASA.

## Inventory — best picks for a lunar base (all verified `.glb`, < 3.5 MB)

Base path: `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/<Folder>/<File>`

| Model | Size | Use in scene |
|-------|------|--------------|
| Apollo Lunar Module | 717 KB | Hero lander on the landing pad |
| Astronaut | 763 KB | Scale-giving figure near habitat |
| Extravehicular Mobility Unit (spacesuit) | 3.4 MB | Detail figure / EVA prop |
| Habitat Demonstration Unit (part 1) | 517 KB | Habitat cluster (already in project) |
| Habitat Demonstration Unit (part 2) | ~0.7 MB | Habitat cluster (already in project) |
| 70-meter Dish | 2.2 MB | Comms ridge dish |
| Gateway Core | **66 MB ⚠️** | Out of web budget — skip or decimate hard |

Copy-paste download URLs:

```
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Apollo%20Lunar%20Module/Apollo%20Lunar%20Module.glb
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Astronaut/Astronaut.glb
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Extravehicular%20Mobility%20Unit/Extravehicular%20Mobility%20Unit.glb
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%201).glb
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/Habitat%20Demonstration%20Unit/Habitat%20Demonstration%20Unit%20(part%202).glb
https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/3D%20Models/70-meter%20Dish/70%20meter%20dish.glb
```

Other usable folders (newer = `.glb`): Deep Space Network dishes, satellites
(Cassini/Voyager/Juno/etc. — read as generic orbital hardware), Crew Lock Bag,
Helmet/Glove. Legacy models (Curiosity Rover, older Apollo CM, Hubble) are
`.blend`/`.3ds`/`.stl` and need Blender→glTF conversion.

## Gaps NASA can't fill

- **No good lunar rover** — only Curiosity, and only as `.blend`. For robotic rover
  variety (WS-3) use CC0 third-party: Kenney "Space Kit", Poly Pizza, Quaternius.
- **No solar array** — keep the existing `solar-panel.glb` / source CC0.
- **No moon terrain mesh** — terrain stays procedural (WS-4). For real elevation,
  LOLA/LDEM DEMs exist but are out of scope.

## Formats & conditioning

NASA GLBs are **not** web-optimized (no Draco, full-res embedded textures). Run
every chosen GLB through `scripts/condition-asset.mjs` (Draco + recenter +
fit-to-unit) before shipping — same pipeline the existing set-pieces use. Consider
`gltf-transform` for texture resize / KTX2 if VRAM is tight.

## Licensing (safe to ship)

- NASA-3D-Resources README: **"free and without copyright"** → effectively public
  domain. Matches the project's NASA-PD ship rule.
- **Carve-out: NASA insignia (meatball), logotype (worm), and seal are fenced off.**
  Don't display them; NASA explicitly prohibits insignia use with AI-generated
  imagery and in advertising. **Audit each GLB's textures for baked-in marks before
  shipping** — strip or hide any that carry them. Geometry is always fine.
- Attribution: a courtesy credit ("3D models courtesy of NASA") in
  `public/assets/CREDITS.md` covers it; not a hard legal requirement, and explicitly
  not required in advertising.
- Don't present the scene as NASA-endorsed.
