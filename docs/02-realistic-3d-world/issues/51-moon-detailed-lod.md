# Sky bodies — Moon globe (orbit view) + Earth (surface view)

- **Issue:** [#51](https://github.com/IamP5/fiap-gs-space-connect/issues/51)
- **Epic:** [#46](https://github.com/IamP5/fiap-gs-space-connect/issues/46)
- **Labels:** `area:frontend`, `type:feature`
- **Type:** AFK

## What to build

The worksite is **on the Moon**, so the Moon is never in the surface sky. Two distinct decorative sky bodies (Scenery — snapshot-independent), swapped with the view mode (#49), both NASA-PD:

- **Moon globe — orbit view only.** A `<Detailed>` (THREE.LOD) sphere sized for **orbit zoom distances** (not "shrinks to a dot at the surface"): L0 orbit-close = color + normal + roughness; L1 pull-back = color + normal. Hidden in surface mode. Crater relief via **normal map, never displacementMap**.
- **Earth — surface view only.** A small low-segment sphere + Earth color map, hanging in the black surface sky (the Apollo *Earthrise* read). No LOD, no normal map. Hidden in orbit mode.

**Texture source (easy default):** NASA-3D-Resources textures, `master` branch — `Images and Textures/Moon/Moon.jpg` (3.0 MB) and `Images and Textures/Earth (A)/Earth (A).jpg` (1.4 MB), fetched via `raw.githubusercontent.com/nasa/NASA-3D-Resources/master/<encoded path>` (use the `.jpg`, skip the 11–50 MB `.tif`). **Higher-fidelity option** for the Moon: bake NASA SVS LROC color + LDEM-derived normal offline. Self-host all; credit `NASA / <author>`.

Starfield (from #50) shows in both views. The programmatic view toggle must `invalidate()` after swapping which body is visible, or LOD/visibility sticks under the demand loop.

## Acceptance criteria

- [ ] Self-hosted Moon color (+ optional normal) + Earth color map in web/public/assets/ (NASA-PD, credited)
- [ ] Moon globe (<Detailed>, orbit zoom tiers) shows in orbit view, hidden at the surface
- [ ] Earth body shows in surface view, hidden in orbit view; no Moon in the surface sky
- [ ] Crater relief via normal map (not displacement)
- [ ] View toggle calls invalidate() after swapping body visibility; idle stays 0 fps

## Blocked by

- [#49](https://github.com/IamP5/fiap-gs-space-connect/issues/49)
- [#50](https://github.com/IamP5/fiap-gs-space-connect/issues/50)
