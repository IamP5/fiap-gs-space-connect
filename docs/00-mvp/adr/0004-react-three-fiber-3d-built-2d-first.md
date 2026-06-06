# The dashboard is react-three-fiber 3D, built 2D-first as a scaffold

**Status:** accepted

The dashboard is a React + react-three-fiber 3D lunar scene, deviating from the PRD's locked Angular + 2D Canvas. It is built against a throwaway 2D canvas **first**, with 3D layered on last so it stays cut-able.

## Context

The self-heal is fundamentally a spatial, embodied story — a rover dies *here* and another drives over from *there* to finish the wall — and the PRD itself names this the "entire pitch." A 2D grid narrates that; a 3D scene lets an evaluator *feel* it, which is where the gasp lives. The countervailing risks (r3f scope creep on camera/lighting/assets, and raycast click-to-kill misfiring on a projector where a 2D hit-target never misses) are real but manageable given the builder is Claude Code (code volume is cheap) and the team has some r3f exposure.

## Decision

- Ship react-three-fiber 3D, scope-guarded hard: one CC0 rover glTF + primitive geometry, a fixed default orbit-camera angle, bloom only on status halos, no custom physics, and **NO UNLICENSED ART** — licensed glTF models and PBR/HDR textures (CC0, CC-BY 4.0 with attribution, or NASA/US-gov public-domain) **ARE** admissible, provided three invariants hold: **(1)** the scene remains a **PURE FUNCTION OF THE SNAPSHOT** — every mesh that represents world state derives from the authoritative snapshot via `lib/scene.ts`; decorative, snapshot-independent elements (terrain, lighting, the SpaceEnvironment moon/stars/backdrop) are permitted because they encode no world state; **(2)** every glTF/texture has a **MANDATORY PRIMITIVE FALLBACK** so a missing/slow/failed asset never breaks the render (the SpecModel box fallback and SpecPrimitive flat-color fallback); **(3)** the **DEMAND-LOOP PERF BUDGET** is preserved — `frameloop="demand"` stays at zero idle fps, dpr capped at 1.5, draw calls bounded via instancing/LOD, and any animated/decorative element `invalidate()`s only during active beats or interaction.
- Build sequence: wire the entire kill→heal→complete flow end-to-end against a **2D canvas placeholder first**, prove the backend is rock-solid, then swap in the r3f scene. The 2D version is nearly free to generate and is the rehearsed **fallback** if 3D iteration threatens the demo.
- Both renderers are pure functions of the same server-authoritative WebSocket snapshot — no client-side simulation, so neither can lie about World Model state.

## Considered options

- **Angular + 2D Canvas (the PRD lock)** — rejected as the *primary*: a flat grid underserves the spatial pitch and risks reading as "unfinished" in a visual-impact-weighted academic evaluation. Retained as the build-first scaffold and the live fallback.
- **Raw three.js** — rejected: r3f's declarative scene-as-components maps cleanly to swarm state (a rover is a `<Rover>` keyed by id) and subscribes to the socket trivially.

## Consequences

- The PRD's actual acceptance (the tested deep core) is never hostage to 3D scope creep, because the core is wired and demoable in 2D before any r3f work begins.
- Click-to-kill must be hardened against raycast misfire (clear hit-targets, a confirm affordance) so the one interaction that matters cannot miss on stage.
