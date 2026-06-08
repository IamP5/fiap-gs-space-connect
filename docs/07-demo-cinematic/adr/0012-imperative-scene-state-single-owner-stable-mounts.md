# Imperative three.js scene state: single-owner props + stable mount roots

**Status:** accepted (2026-06-08)

R3F renders a React component tree, but a handful of rendering controls live on the
three.js `Scene` object as **plain mutable fields** that React does NOT reconcile:
`scene.background`, `scene.backgroundIntensity`, `scene.backgroundRotation`,
`scene.environment`, `scene.environmentIntensity`. They are global, last-writer-wins
state. Several things write them: our own imperative loaders (the Milky-Way equirect
in `StarBackground`), per-view grade effects, and — critically — drei's
`<Environment>`, which **re-applies ALL of these on every render** (its
`EnvironmentCube`/`EnvironmentMap` layout effect in `@react-three/drei`
`core/Environment.js` has **no dependency array**, and `setEnvProps` defaults the
ones you don't pass to `backgroundIntensity:1`, `backgroundRotation:[0,0,0]`,
`environmentIntensity:1`).

This produced a whole class of bugs in the cinematic: the dust band lost its tilt +
brightness and the orbit Moon's IBL grade reset to full on **every** interaction
(reload-demo, arm, and at each surface↔orbit transition's settle). Two distinct
React/three.js mismatches were behind it, found by trapping the live scene's
property setters and capturing stack traces.

## Decision

Two rules for any imperative three.js scene state under R3F:

1. **Single owner per `scene.*` property.** Each of `background`,
   `backgroundIntensity`, `backgroundRotation`, `environment`,
   `environmentIntensity` (and friends) has exactly ONE writer. Two components
   writing the same field will fight, and the one that re-runs more often wins
   non-deterministically.

2. **If drei `<Environment>` is in the tree, it OWNS the modifier props — drive
   them via props, never also set them imperatively elsewhere.** drei re-asserts
   `backgroundIntensity` / `backgroundRotation` / `environmentIntensity` /
   `environmentRotation` on every render; the only way to keep your values is to
   pass them as `<Environment>` props so its per-render apply asserts *them*
   instead of its defaults. A second component's `useEffect` with stable deps will
   set the field once and then never re-run to repair drei's clobber.

   - We keep `scene.background` (the equirect TEXTURE) owned by our own loader
     (`StarBackground`) because drei with `background={false}` never touches that
     slot. Everything drei *does* touch (`backgroundIntensity`,
     `backgroundRotation`, `environmentIntensity`) is passed to `<Environment>` and
     removed from our code (the old `EnvironmentGrade` imperative setter is gone).

3. **A component that owns imperative scene state (or holds generate-once geometry)
   must mount at a STABLE position with a STABLE root element TYPE.** React cannot
   reconcile a position whose element type changes (e.g. a `<>` fragment in one
   branch and a `<group>` in another); it unmounts and remounts the whole subtree.
   A remount re-runs `useMemo([])` geometry (re-randomizing `<Starfield>`) and tears
   down/re-installs imperative scene state. So snapshot-independent scenery is
   rendered unconditionally in one stable root; only data-dependent content is
   gated behind conditionals *inside* it.

## Considered options

- **Keep two owners but make them agree (pass values to drei AND keep the
  imperative setter).** Rejected: redundant, and still order-dependent on first
  mount (whoever runs first defines drei's captured "old" restore value). One owner
  is simpler and provably stable.
- **Stop using drei `<Environment>`; load the HDR + set `scene.environment`
  ourselves** (symmetric with how we own `scene.background`). Viable and removes
  drei's meddling entirely, but loses drei's PMREM prefiltering and is a larger
  change. Deferred — passing props is sufficient and keeps drei's IBL quality.
- **Memoize / `key` the subtree to prevent remounts** instead of unifying the root
  element type. Rejected: fragile (any new conditional can reintroduce the type
  swap); a single stable root is the structural fix.

## Consequences

- **ADR-0004 snapshot-purity intact.** None of this reads or invents world state —
  it's all decorative Scenery configuration. The fixes are pure rendering
  corrections (a re-render is still a pure re-render; now it doesn't thrash global
  scene state).
- **Determinism for the cinematic.** The dust band and IBL grade now survive
  reload-demo and every transition settle, so the orbit bookend frames identically
  take after take.
- **A debugging technique worth keeping:** when a `scene.*` field changes with no
  obvious writer, trap it with an accessor (`Object.defineProperty(scene,
  'backgroundRotation', { set })`) that records `new Error().stack`. The clobber's
  stack named drei's `setEnvProps` cleanup immediately — static grep had found only
  our own writers. (Note: `applyProps` mutates math types in place via `.copy()` /
  `.set()`, so an assignment trap sees number props like intensity but not Euler
  mutations — verify by reading the value, not only by trapping `set`.)
- **Watch list:** any future component that sets a `scene.*` field imperatively, or
  any new conditional `return` in `SceneContents`-style components, must respect
  rules 1–3 or the class of bug returns.

## History

- **2026-06-08:** the Milky-Way band reset to a flat starfield on every
  interaction. First fix unified `SceneContents`' two return roots (fragment vs
  `<group>`) into one stable `<group>` (rule 3) — necessary but not sufficient.
  Live-scene setter traps then revealed drei `<Environment>`'s no-dep-array
  re-apply clobbering `backgroundIntensity`/`backgroundRotation` (rule 2); making
  drei the single owner via props fixed it. The same pattern was then found for
  `environmentIntensity` (the old `EnvironmentGrade` imperative setter contended
  with drei) and fixed identically. See `web/src/components/SpaceEnvironment.tsx`
  (`StarBackground` / `HdrBackdrop`) and `web/src/components/Scene3D.tsx`
  (`SceneContents`).
