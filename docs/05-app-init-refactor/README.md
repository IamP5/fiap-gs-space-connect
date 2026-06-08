# [Epic] App initialization refactor — loading screen, orbit-default, 3D-only

- **Issue:** [#127](https://github.com/IamP5/fiap-gs-space-connect/issues/127) (epic)
- **Labels:** `area:frontend`, `type:refactor`
- **Type:** Epic (frontend-only — boot sequence, asset preload, default view, camera feel)
- **Builds on:** the [realistic-3d-world](../02-realistic-3d-world/README.md)
  milestone (orbit hero vista #81–91, vendored NASA assets, asset catalog) and the
  Wave 3/4 cinematic polish
- **ADR(s) to honor:** ADR-0004 (scene is a pure function of the snapshot; mandatory
  primitive fallbacks). NB: this epic **retires the 2D "rehearsed fallback"** framing
  of ADR-0004 — the in-scene primitive/box fallbacks remain the resilience story.

## What to build

Reshape the boot sequence so the app opens as a polished space experience:

1. **Remove the 2D scene** — drop the `WorldCanvas` renderer and the 3D/2D toggle;
   3D is the only renderer.
2. **Loading screen** — preload **all** assets (orbit *and* surface) behind a
   branded splash, so the scene initializes only once everything is ready and
   nothing pops in later (even on descent to the surface).
3. **Orbit is the default view** — open on the Moon vista, not the surface worksite.
4. **Idle camera drift starts immediately** — the gentle "user stopped interacting"
   sway begins the moment the scene is revealed, not after a 4 s idle wait.
5. **Base mark on the light side** — move the lunar base marker onto the Moon's
   sunlit hemisphere (today it seats on the camera-facing near face, which under
   orbit lighting falls near the terminator).

### Why

The app boots straight into the surface worksite behind a 3D/2D toggle, loads 3D
assets lazily (they visibly pop in), and only animates the camera after 4 s of
inactivity. The orbit vista is the strongest visual the project has, the 2D canvas
is no longer the product, and a "load then reveal" splash removes the pop-in. The
user explicitly chose **preload truly everything** (crisp descent, no pop-in) and
**settle into orbit with idle drift immediately** (no auto push-in) when asked.

## Approach (decisions locked)

- **3D-only:** delete `WorldCanvas.tsx` + its only consumer `hitTest.ts`; keep
  `choreography.ts` (shared with the 3D scene).
- **Explicit preload manifest** (`lib/assets.ts`) — "load all assets" is otherwise
  undefined because surface assets are view-gated and never load in orbit. Loaders
  run without a GL context, so preload completes *before* the Canvas mounts (a
  literal "load all, then initialize").
- **Warm the real caches:** delegate GLB preloads to the existing module-level
  `gltfCache`/`sceneryCache`; add a shared URL-keyed texture cache so the descent
  reuses decoded textures (no pop-in).
- **Deterministic splash:** drive the progress bar from the preload promise (avoids
  drei `useProgress`'s 0/0-is-100 race); reveal on completion **or** a safety
  timeout so a hung request never traps the user (ADR-0004 ethos).
- **Orbit default + immediate idle drift:** the existing surface intro fly-in
  self-disables (it only runs for surface); seed the idle clock pre-elapsed so the
  sway begins on the first revealed frame.

Full design, exact file/field edits, and verification: see
[IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

## Acceptance criteria

- [x] **P0** 2D scene fully removed — no `WorldCanvas`/`hitTest` references, no
      3D/2D toggle in the header; `npm run build` TS-clean and tests green.
- [x] **P1** Loading screen shows a filling progress bar on boot; the Canvas mounts
      only after preload completes (or the safety timeout fires).
- [x] **P2** App opens in the **orbit** Moon vista with the **idle camera drift
      already moving** — no 4 s wait, no auto push-in.
- [x] **P3** Clicking the base marker descends to the surface and the worksite
      renders **crisp with no box/placeholder pop-in** (caches warmed by preload).
- [x] **P4** The base marker sits on the Moon's **sunlit** hemisphere in orbit and
      is clickable.
- [x] Docs/harness truthful: ADR-0004 / `AGENTS.md` note the 2D fallback retired;
      `feature_list.json` / `PROGRESS.md` updated.
- [x] Broken into vertical slices via `/to-issues` (epic #127).

## Slices (dependency-ordered)

- [x] **#128** — Remove the 2D scene (3D-only) · `r3d-128` · _no blockers_ (P0)
- [x] **#129** — Loading screen + preload-everything · `r3d-129` · blocked by #128 (P1)
- [x] **#130** — Orbit default + immediate idle drift · `r3d-130` · blocked by #129 (P2)
- [x] **#131** — Base mark on the sunlit hemisphere · `r3d-131` · blocked by #130 (P3/P4)

## Scope-balloon flags (OUT of v1)

Auto cinematic push-in on orbit reveal (rejected — settle + drift only) · refactor
of the GLB caches (reuse the existing module-level maps) · per-asset retry/back-off
(safety timeout instead) · changing the surface intro fly-in machinery (left as-is,
self-disables under the orbit default).
</content>
