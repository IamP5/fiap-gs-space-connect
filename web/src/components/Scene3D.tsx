// Scene3D — the react-three-fiber lunar diorama (ADR-0004).
//
// A PURE function of the latest world snapshot: low-poly lunar terrain, rovers,
// status halos (idle/bidding/working/dead), lease beams from each rover to the
// task it holds, and the habitat dome rising block-by-block as tasks complete.
// There is NO client-side simulation — every mesh position is derived from the
// authoritative snapshot via lib/scene.ts, so the scene can never lie about
// World Model state. Choreography beats (lib/choreography.ts) only DECORATE.
//
// The sole renderer of the worksite, on the `{ snapshot, selected, onPick }`
// contract App threads in.
//
// PERFORMANCE MODEL (the dashboard must run light on a projector laptop):
//   - frameloop="demand": the render loop is IDLE unless something changed. We
//     invalidate() on a new snapshot and WHILE beats animate; OrbitControls
//     (makeDefault) invalidates during interaction. No 60fps idle burn.
//   - Beats animate by MUTATING mesh/material refs inside useFrame — they NEVER
//     trigger a React re-render. The snapshot→mesh tree only re-renders when a
//     new snapshot arrives (~12 Hz), not per animation frame (r3f-fundamentals
//     "Avoiding Re-renders"; r3f-animation "Transient Subscriptions").
//   - Geometry buffers are shared: ONE set is created per Canvas mount and
//     disposed on unmount, instead of every rover allocating its own
//     (r3f-geometry "Reuse geometries").
//   - dpr capped at 1.5 and bloom kept cheap (small kernel, no MSAA).
//
// HARD SCOPE GUARD (ADR-0004 — obeyed here):
//   - LICENSED art only (CC0 / CC-BY 4.0 with attribution / NASA-PD), NEVER
//     unlicensed art. glTF models and PBR/HDR textures ARE admissible, but each
//     MUST carry a primitive fallback (the SpecModel box / SpecPrimitive flat
//     color) so a missing/slow/failed asset never breaks the render. The rover
//     ships as PRIMITIVE geometry (low-poly box body + cylinder wheels) — the
//     documented fallback — and licensed glTFs swap in through the buildspec seam.
//   - ONE fixed default orbit-camera angle (OrbitControls allowed, clamped).
//   - BLOOM ONLY on the status halos, via a selective-bloom layer limited to the
//     halo meshes (never full-scene bloom). See HALO_BLOOM_LAYER below.
//   - No custom physics; only LICENSED art (CC0/CC-BY/NASA-PD), each with a
//     mandatory primitive fallback.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Html, Instance, Instances, Line, OrbitControls } from "@react-three/drei";
import { SpaceEnvironment, STARFIELD_PARALLAX_NAME } from "./SpaceEnvironment";
import { SkyBodies } from "./SkyBodies";
import {
  ChromaticAberration,
  DepthOfField,
  EffectComposer,
  GodRays,
  Noise,
  SelectiveBloom,
  SMAA,
  Vignette,
} from "@react-three/postprocessing";
import {
  BlendFunction,
  KernelSize,
  type GodRaysEffect,
  type SelectiveBloomEffect,
} from "postprocessing";
import * as THREE from "three";
import type { RoverView, Snapshot, TaskView, Vec2 } from "../types/wire";
import { batteryPercent } from "../lib/format";
import { suppressRaycast } from "../lib/suppressRaycast";
import { applyGltfTextureFidelity, polishGltfMaterials } from "../lib/textureFidelity";
import { loadTexture, preloadTexture } from "../lib/textureCache";
import { reportAssetError, reportAssetWarning } from "../lib/assetLog";
import {
  CRATER_OUTER_RADIUS,
  EARTH_POSITION,
  GROUND_SPAN,
  MOON_POSITION,
  ORBIT_SUN_POSITION,
  REAL_METERS,
  SCENE_UNITS_PER_METER,
  SITE_FRAMES,
  SKYLIGHT_CENTER,
  SKYLIGHT_OUTER_RADIUS,
  SKYLIGHT_MOUTH_RADIUS,
  SKYLIGHT_RIM_RADIUS,
  type SceneMap,
  type SiteFrame,
  craterProfile,
  isBuilt,
  siteMap,
  skylightProfile,
  tierHeight,
  tierOf,
} from "../lib/scene";
import {
  type ActiveBeat,
  activeBeats,
  activeBidders,
  beatProgress,
  bidWarStrobe,
  earthriseEnvelope,
  launchShake,
} from "../lib/choreography";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  type MeshDesc,
  type ModelDesc,
  type PrimitiveDesc,
  interpretBuildSpec,
} from "../lib/buildspec";
import { type Ghost, dragDeltaToRadians, footprintOf } from "../lib/placement";
import {
  IDLE_DELAY_MS,
  ORBIT_EXPOSURE_SCALE,
  SURFACE_EXPOSURE_SCALE,
  PARALLAX_SETTLE_EPS,
  advanceParallax,
  idleSwayOffset,
  zoomExposure,
} from "../lib/cameraFeel";
import {
  OPEN_MS,
  alignOpenCameraElevation,
  openAzimuthOffset,
} from "../lib/reel/openArc";
import { LaunchScenery } from "./LaunchScenery";
import { LavaTubeSkylight, LavaTubeBoulders } from "./LavaTube";
import { LunarBaseDecals } from "./BaseDecals";

// Functional telemetry colors (DESIGN.md: live-data signals only — the brand
// palette itself is black + white). Matched to the 2D canvas so the two
// renderers read identically.
const SIGNAL_OK = "#2ecc71"; // working / done
const SIGNAL_WARN = "#f5a623"; // bidding / leased
const SIGNAL_DOWN = "#e74c3c"; // dead / kill target
const SIGNAL_IDLE = "#9aa4b2"; // idle / unclaimed
const SIGNAL_REVIVE = "#38e1ff"; // recovered — the in-place comeback pulse

// A dedicated render layer for the halo meshes. SelectiveBloom is told to bloom
// ONLY objects on this layer, so the glow is confined to status halos and never
// leaks onto the terrain, rovers, or dome (ADR-0004's "bloom only on halos").
const HALO_BLOOM_LAYER = 11;

// A SECOND selective-bloom layer for the brightest CELESTIAL bodies — the Sun
// core and Earth's limb (SkyBodies). The halo bloom (above) is tuned tight for
// the small status halos; the celestial pass is a separate SelectiveBloom with a
// lower luminance threshold and a wider kernel so the genuinely bright bodies
// glow softly, without leaking that glow onto the terrain/rovers (still layer-
// gated, never full-scene — ADR-0004). Exported so SkyBodies can enable it on the
// Sun core mesh and Earth rim shell.
export const CELESTIAL_BLOOM_LAYER = 12;

// Subtle orbit-only chromatic-aberration offset. A module-level constant (stable
// reference) so it never re-triggers the memoized effect across renders.
const CHROMATIC_OFFSET = new THREE.Vector2(0.0006, 0.0012);

// The sun's orthographic shadow camera looks from the (per-site) surface sun
// position toward the origin worksite; its near/far bracket the worksite slab at
// the sun's distance along that ray. The distance is now computed PER SITE inside
// SpaceLights (each site has its own sunDir), so this is no longer a module const.

// Half-extent of the sun shadow-camera frustum (#104) — clamps the 2048 map to
// the ±25-unit worksite (GROUND_SPAN=20 + margin) so resolution isn't wasted on
// the far regolith plain.
const SHADOW_WORKSITE_HALF = 25;

// SPACE LIGHTING rig — extracted (Wave 4) so it renders IDENTICALLY in BOTH the
// snapshot-loaded scene and the pre-snapshot fallback branch. Lighting is decorative
// / snapshot-INDEPENDENT (ADR-0004), so it must never live only inside the
// snapshot-gated return — otherwise the orbit vista shows a flat-lit Moon until the
// first snapshot arrives. Three contributions, all VIEW-CONDITIONAL on `onSurface`:
//   1. SUN — the white key light, DECOUPLED (Wave 4): surface keeps SUN_POSITION
//      (lights the worksite on the Moon's near face); orbit swings to
//      ORBIT_SUN_POSITION so the Moon reads dark-with-crescent (SVS #14992). The two
//      views never co-render, so the swing is unseen. The Moon globe isn't inside the
//      ±25 worksite shadow frustum, so its terminator is pure diffuse and follows
//      this light for free.
//   2. EARTHSHINE — a cool desaturated point light FROM Earth (inverse-square). In
//      orbit the sun back-lights the Moon, so this faint fill is the ONLY light on the
//      camera-facing near side (Earth sits in the camera's hemisphere off the Moon,
//      dot≈0.89). Kept VERY low so the dark side stays dramatically dark with only
//      barely-readable detail — the brilliant sunlit crescent is the contrast.
//   3. Ambient + hemisphere floors — near-black in orbit so the void + shadow side
//      stay dark; lifted on the surface for worksite legibility. Plus surface-only
//      rim/fill directionals (skipped in orbit — the Moon stays a clean dark hero).
// Orbit IBL grade (Wave 4) — the HDR <Environment> lights the Moon via scene
// environment diffuse irradiance, and that (not the named lights) is what sets the
// Moon's overall brightness. The grade (dim hard in orbit so the far side reads as
// a dramatic dark crescent; full IBL on the surface for metallic rover/glTF
// reflections) is now owned by drei's <Environment> directly via its
// environmentIntensity prop (see ENV_INTENSITY_* in SpaceEnvironment.tsx). drei
// re-applies scene env props on EVERY render, so an imperative setter here would be
// clobbered back to drei's default (1) on the next interaction — the same class of
// bug as the background band. Single owner = drei.

function SpaceLights({
  onSurface,
  lightRef,
  surfaceSunDir,
  surfaceSunIntensity,
  crater = false,
}: {
  onSurface: boolean;
  lightRef: React.RefObject<THREE.DirectionalLight>;
  // Per-site SURFACE key-light direction + intensity (Epic 04 P2). Lunar: a high
  // bright key; Shackleton: a low grazing pole sun that reads dimmer. The orbit Sun
  // *body* light stays at the global ORBIT_SUN_POSITION (the two views never co-
  // render). The shadow-camera near/far track the chosen sun's distance so the
  // worksite slab stays inside the frustum at either site's sun angle.
  surfaceSunDir: [number, number, number];
  surfaceSunIntensity: number;
  // Shackleton crater fill: the near-horizontal pole sun is OCCLUDED by the carved
  // rim, so the bowl floor (where the outpost sits) is in shadow and the grazing key
  // light can't reach it. Lift the cool ambient/hemisphere FILL when on the crater
  // floor so the shadowed-floor relief + outpost read as cold dark rock — the way
  // reflected light picks out a permanently-shadowed crater (SVS 4716) — without
  // flattening the dramatic sunlit rim ridge (still lit by the directional key).
  crater?: boolean;
}) {
  const sunPos = onSurface ? surfaceSunDir : ORBIT_SUN_POSITION;
  const sunLen = Math.hypot(sunPos[0], sunPos[1], sunPos[2]);
  const craterFill = onSurface && crater;
  return (
    <>
      {/* WS-5 (#172): CRUSH the lunar fill so shadows fall near-black for the hard-
          sun, high-contrast look (no atmosphere = no scatter fill). Ambient 0.12 →
          0.05. The Shackleton crater floor KEEPS its lifted cool fill (it's in
          permanent rim shadow, lit only by reflected light — a different place). */}
      <ambientLight
        color={craterFill ? "#1a2230" : "#0e1014"}
        intensity={onSurface ? (craterFill ? 0.34 : 0.05) : 0.01}
      />
      {/* Lunar hemisphere fill cooled (#ffe9cc warm → neutral cool) + dimmed
          (0.25 → 0.1): the warm sky-fill was part of the "muddy brown" cast and it
          lifted shadows. Shackleton's craterFill branch unchanged. */}
      <hemisphereLight
        args={[craterFill ? "#aebfd6" : "#cdd6e2", "#1a1814", onSurface ? (craterFill ? 0.6 : 0.1) : 0.0]}
      />
      <directionalLight
        ref={lightRef}
        position={sunPos}
        color="#ffffff"
        intensity={onSurface ? surfaceSunIntensity : 1.9}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={sunLen - SHADOW_WORKSITE_HALF - 35}
        shadow-camera-far={sunLen + SHADOW_WORKSITE_HALF + 35}
        shadow-camera-left={-SHADOW_WORKSITE_HALF}
        shadow-camera-right={SHADOW_WORKSITE_HALF}
        shadow-camera-top={SHADOW_WORKSITE_HALF}
        shadow-camera-bottom={-SHADOW_WORKSITE_HALF}
        shadow-normalBias={0.05}
        shadow-bias={-0.0005}
      />
      <pointLight
        position={EARTH_POSITION}
        color="#a8bfda"
        decay={2}
        distance={0}
        // Orbit earthshine LIFTED: in the SVS #14992 reference the Moon's SHADOW side is
        // not black — its maria/craters are picked out by cool reflected earthlight. This
        // raking fill from Earth's position reveals that dark-side relief so the near-half-
        // lit Moon reads as detailed dark rock, never a void. Sized to the (now farther)
        // Earth berth: decay=2 inverse-square over |Earth→Moon| ≈ 4.5k needs ~1.35M to land
        // the same illuminance the closer berth got from a smaller number.
        intensity={onSurface ? 2_310_000 : 1_350_000}
      />
      {onSurface && (
        <>
          {/* WS-5 (#172): the secondary fills are crushed too (cool 0.35 → 0.16,
              warm 0.22 → 0.07) — they were the "muddy mid-grey wash" lifting the
              shadow side. A whisper of cool earthshine fill stays so shadow detail
              isn't pure black; the warm bounce is nearly gone (it browned the grey). */}
          <directionalLight position={[-40, 26, -30]} color="#9fb6d8" intensity={0.16} />
          <directionalLight position={[36, 22, 28]} color="#ffd9b0" intensity={0.07} />
        </>
      )}
    </>
  );
}

// ---- shared geometry buffers ------------------------------------------------

// Every rover/task draws from the SAME geometry instances, created once per
// Canvas mount and disposed on unmount (r3f-geometry "Reuse geometries"). This
// is the difference between holding ~10 GPU buffers and ~10×N. Built in a
// useMemo so a 3D→2D→3D toggle gets a fresh, valid set each remount.
type SceneGeo = {
  hit: THREE.SphereGeometry;
  body: THREE.BoxGeometry;
  mast: THREE.BoxGeometry;
  wheel: THREE.CylinderGeometry;
  halo: THREE.RingGeometry;
  won: THREE.RingGeometry;
  sel: THREE.RingGeometry;
  battery: THREE.BoxGeometry; // unit box, scaled in x by charge
  foundation: THREE.BoxGeometry;
  wall: THREE.BoxGeometry;
  dome: THREE.SphereGeometry;
  // Unit primitives for the Build-spec interpreter (ADR-0006): each interpreted
  // op reuses one of these and is scaled per-op, so a spec of N ops still costs
  // only these 3 shared GPU buffers (r3f-geometry "Reuse geometries").
  specBox: THREE.BoxGeometry;
  specCylinder: THREE.CylinderGeometry;
  specSphere: THREE.SphereGeometry;
};

// withUV2 copies a geometry's primary uv set into uv2 so a material's aoMap (and
// any second-channel map) is visible — three reads aoMap from uv2, which the
// built-in primitive geometries do not provide by default (three 0.169). Returns
// the same geometry for chaining. No-op if it has no uv attribute.
function withUV2<T extends THREE.BufferGeometry>(g: T): T {
  const uv = g.attributes.uv;
  if (uv && !g.attributes.uv2) g.setAttribute("uv2", uv);
  return g;
}

function makeSceneGeo(): SceneGeo {
  return {
    hit: new THREE.SphereGeometry(0.95, 16, 16),
    body: new THREE.BoxGeometry(0.7, 0.34, 0.95),
    mast: new THREE.BoxGeometry(0.3, 0.2, 0.3),
    wheel: new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12),
    halo: new THREE.RingGeometry(0.62, 0.82, 40),
    won: new THREE.RingGeometry(0.82, 0.98, 40),
    sel: new THREE.RingGeometry(0.9, 1.02, 48),
    battery: new THREE.BoxGeometry(1, 0.06, 0.06),
    foundation: new THREE.BoxGeometry(1.1, 0.3, 1.1),
    wall: new THREE.BoxGeometry(0.9, 1.1, 0.9),
    dome: new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    // Unit primitives (edge/diameter 1) so a Build op's scale maps directly.
    // withUV2 gives each a uv2 channel so a Material.aoMap renders (three reads
    // aoMap from uv2). uv2 == uv, so it is harmless when no aoMap is present.
    specBox: withUV2(new THREE.BoxGeometry(1, 1, 1)),
    specCylinder: withUV2(new THREE.CylinderGeometry(0.5, 0.5, 1, 20)),
    specSphere: withUV2(new THREE.SphereGeometry(0.5, 20, 16)),
  };
}

function disposeSceneGeo(g: SceneGeo) {
  for (const key of Object.keys(g) as (keyof SceneGeo)[]) g[key].dispose();
}

// Rover status → halo color. Idle (alive, no task), bidding (a transient beat,
// handled separately), working (alive, holding a task), dead. Pure read of the
// snapshot rover.
function roverHaloColor(r: RoverView): string {
  if (!r.alive) return SIGNAL_DOWN;
  if (r.task) return SIGNAL_OK; // working — holds a task
  return SIGNAL_IDLE; // idle — alive, unassigned
}

// ---- the realistic rover model (#54) ---------------------------------------
//
// The worker-entity render: every Rover swaps its PRIMITIVE body (box + mast +
// wheels) for ONE configured, self-hosted NASA-PD glTF (RASSOR). This is NOT a
// Build-spec catalog Asset — it never goes through the Asset catalog; the model
// is fixed for all rovers. It loads via the module-level loadGLTF helper (DRACO +
// meshopt wired, raycast suppressed on the cached source) and FALLS BACK to the
// primitives forever if the asset is missing/slow/fails, so the scene is never
// blank (ADR-0004). The loaded tree is raycast-suppressed so the rover's
// invisible hit-proxy sphere stays the SOLE pickable surface (click-to-kill
// determinism, #48).

// The one configured rover model. Self-hosted, conditioned + Draco-compressed by
// scripts/condition-asset.mjs (recentered, fit-to-unit). A missing file just
// keeps the primitive fallback below.
// WS-3 (#171): the active rover is NASA's iconic Mars 2020 Perseverance — a real
// NASA-PD asset (detailed chassis + rocker-bogie 6-wheel suspension + Mastcam-Z/NavCam
// mast + robotic arm), 116 meshes / ~126k verts, insignia-clean, 1.47 MB Draco+webp. Replaces
// the earlier featureless `rassor_rover.glb` shrinkwrap (read as a pod) and a stop-gap
// CC0 low-poly rover (read as a toy). Source + provenance in CREDITS.md.
// Exported so the preload manifest (lib/assets.ts) references the SAME URL the
// renderer uses — the manifest can't drift from the component (Epic 05 P1).
export const ROVER_MODEL_REF = "/assets/models/rover_nasa.glb";
// The native (authored) size the rover body, primitive fallback, hit-proxy, and
// halos were all laid out at — the model's LARGEST bbox dim fits to this, and the
// primitive box/mast/wheels + hit sphere + halo rings are all proportioned around
// it. We DON'T retune those constants individually; instead the whole rover group
// is scaled by ROVER_SCALE below so its real size is literal (Epic 04 P0) while
// the body still exactly fills its hit-proxy (ADR-0004 no-missed-click).
const ROVER_MODEL_FIT = 1.15;
const ROVER_BASE_SIZE = ROVER_MODEL_FIT;

// The LITERAL scene size of a rover (2.5 m real → 0.3 scene units), from the one
// fixed real-meters→scene-units scale. Both the visible body AND the invisible
// hit-proxy sphere derive from this (the whole rover group is scaled by
// ROVER_SCALE), so a click can never miss the rover the user sees — the proxy and
// the body scale together (Epic 04 P0; ADR-0004).
const ROVER_SCENE_SIZE = REAL_METERS.rover * SCENE_UNITS_PER_METER;
// WS-3 (#171) INTENTIONAL REALISM BREAK — readability over strict scale, for the
// HERO ACTORS only. A literal 2.5 m rover is 0.3 u, a speck against the 4.8–14.4 u
// launch infra, so it reads as neither robot nor agent. We bump the *rover only* by
// ROVER_HERO_SCALE so it lands at ~0.81 u — unmistakably a machine, still smaller
// than the habitats. Structure proportions stay literal (REAL_METERS × units/m); do
// NOT "fix" this back. The whole rover group (body + hit-proxy + halos) scales by
// ROVER_SCALE together, so the invisible pick sphere grows with the body — the
// no-missed-click invariant (ADR-0004) is preserved.
// 5.5× (operator: at 4× the 6-wheel rocker-bogie smeared into "two wheels" — too
// small + softened by the surface DoF to resolve the wheels). The Perseverance bbox
// is long+low (length 1.0 vs height 0.59 of a unit), so it reads lower than a tall
// pod; this lands it as a clearly-present hero machine with its wheels legible.
const ROVER_HERO_SCALE = 5.5;
const ROVER_SCALE = (ROVER_SCENE_SIZE / ROVER_BASE_SIZE) * ROVER_HERO_SCALE;

// fitAndSeatRover normalizes a loaded model in place (mirrors LaunchScenery's
// fitAndSeat): scale its largest dimension to `fit`, recenter on x/z, and seat
// its base on y=0 — so the wrapping rover group drops it cleanly onto the
// ground. NASA glbs have arbitrary native units + off-origin pivots, so a fixed
// scalar is meaningless; we fit at load instead of baking each asset.
function fitAndSeatRover(obj: THREE.Object3D, fit: number) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) {
    // Degenerate glTF (no renderable geometry → empty bbox): seat at the group
    // origin and apply the target scale so it still lands sanely rather than at raw
    // native coords/scale (#171 audit carry-over). Logged so the cause is visible.
    obj.scale.setScalar(fit);
    obj.position.set(0, 0, 0);
    reportAssetWarning("fitAndSeatRover", "empty bounding box (no renderable geometry)");
    return;
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = fit / maxDim;
  obj.scale.setScalar(s);
  obj.position.set(-center.x * s, -box.min.y * s, -center.z * s);
}

// dimRoverModel darkens a cloned rover model's materials so a DEAD rover reads as
// dimmed, mirroring the primitive fallback (which drops the body to #2a2a2e). The
// clone shares the cached source's materials, so we MUST clone each material
// before mutating it — otherwise dimming one dead rover would dim every rover
// (and the cached source) that shares those materials. The cloned materials are
// owned by this placement and disposed on unmount (see RoverBody cleanup). When
// the rover is alive this is a no-op, so live rovers keep the shared materials.
const DIM_ROVER_MULTIPLIER = 0.18;
function dimRoverModel(obj: THREE.Object3D): THREE.Material[] {
  const owned: THREE.Material[] = [];
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const cloned = mats.map((m) => {
      const c = m.clone();
      // Darken whatever standard PBR channels the material exposes; guard each
      // field so this works across MeshStandard/Physical/Basic without assuming a
      // type. multiplyScalar dims the base + emissive so the dead rover goes dark.
      const cc = c as THREE.MeshStandardMaterial;
      cc.color?.multiplyScalar(DIM_ROVER_MULTIPLIER);
      cc.emissive?.multiplyScalar(DIM_ROVER_MULTIPLIER);
      owned.push(c);
      return c;
    });
    mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
  });
  return owned;
}

// RoverBody renders the realistic rover glTF, falling back to the PRIMITIVE body
// (box + sensor mast + 4 wheels) until — and FOREVER if — the model fails to
// load. The primitives are exactly the prior fallback geometry, so a gone/slow
// asset never breaks the rover. The `dim` flag (dead rover) dims BOTH paths: the
// primitives via their material color, the loaded model via dimRoverModel (which
// clones + darkens the model's materials), so a dead rover always reads as dark.
//
// `revived` is the live "revived" beat progress (a ref, 0 = none, →1 = fading):
// the body-color half of the resurrection shockwave (#107). During the beat we
// pulse every body mesh's emissive grey→bright cyan and back, so the rover itself
// flares as it comes back — driven by ref-mutation in useFrame, never a
// re-render. Works on BOTH the glTF and the primitive fallback (we traverse
// whichever is mounted under bodyRef).
const REVIVE_FLASH = new THREE.Color(SIGNAL_REVIVE);
function RoverBody({
  geo,
  dim,
  revived,
}: {
  geo: SceneGeo;
  dim: boolean;
  revived: React.RefObject<number>;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const bodyRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  const bodyColor = dim ? "#2a2a2e" : "#f0f0fa";

  // Materials we CLONE for the resurrection flash, so mutating emissive never
  // touches the SHARED cached glTF materials (which a live rover reuses — dimming
  // them would flash every other rover). Cloned lazily on the first flash frame,
  // then owned + disposed on unmount. The primitive fallback already has its own
  // per-mesh materials, but we clone uniformly so the reset path is identical.
  const flashMats = useRef<THREE.MeshStandardMaterial[] | null>(null);
  const flashing = useRef(false);
  // WS-3 (#171) idle articulation: a per-rover phase so a live swarm doesn't sway in
  // lockstep. Seeded once on mount; drives a tiny continuous yaw + bob in useFrame so
  // an alive rover reads as an *active* machine scanning the site, not a parked prop.
  const idlePhase = useRef(Math.random() * Math.PI * 2);

  // Resurrection body flash (#107): pulse every body mesh's emissive toward bright
  // cyan at the comeback and ease back as the shockwave ring expands. A no-op when
  // no beat is live (progress 0); we reset emissive to 0 exactly once the beat
  // clears, so this costs nothing between revivals — demand-safe.
  useFrame(() => {
    const group = bodyRef.current;
    if (!group) return;
    // Idle articulation (alive rovers only): a subtle scanning yaw + settle bob,
    // local to the body group (so it composes with the snapshot-driven world move).
    // Ref-mutation only — never a re-render. A dead rover holds still.
    if (!dim) {
      const t = performance.now() / 1000;
      group.rotation.y = Math.sin(t * 0.55 + idlePhase.current) * 0.09;
      group.position.y = Math.sin(t * 1.2 + idlePhase.current) * 0.012;
    }
    const p = revived.current ?? 0;
    if (p <= 0) {
      if (!flashing.current) return; // already idle — nothing to reset
      flashing.current = false; // fall through once to reset the flash mats to 0
    } else {
      flashing.current = true;
      if (!flashMats.current) {
        // First flash ever for this body: clone each body material ONCE so we
        // mutate copies, not the SHARED cached glTF originals (which live rovers
        // reuse). The clones stay on the meshes and are reused across every later
        // flash — never re-cloned — and disposed on unmount, so repeated revivals
        // leak nothing.
        const owned: THREE.MeshStandardMaterial[] = [];
        group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || !mesh.material) return;
          if (Array.isArray(mesh.material)) {
            mesh.material = mesh.material.map((m) => {
              const c = m.clone() as THREE.MeshStandardMaterial;
              owned.push(c);
              return c;
            });
          } else {
            const c = mesh.material.clone() as THREE.MeshStandardMaterial;
            owned.push(c);
            mesh.material = c;
          }
        });
        flashMats.current = owned;
      }
    }
    // Brightness peaks early (1 - p) so the flash is strongest at the comeback.
    const intensity = p > 0 ? (1 - p) * 1.6 : 0;
    for (const sm of flashMats.current ?? []) {
      // The clones are TYPED MeshStandardMaterial but a glTF can supply a non-
      // standard material (unlit/basic, points/line) that lacks `emissive` — so
      // narrow on the real type before touching standard-only fields, not just on
      // the `emissive` field (#173 carry-over: keep the unsound cast from biting a
      // future edit that reads more standard props here).
      if (!sm.isMeshStandardMaterial) continue;
      sm.emissive.copy(REVIVE_FLASH);
      sm.emissiveIntensity = intensity;
    }
  });

  // Dispose the flash material clones we own on unmount/reload (never the shared
  // cached materials, which the clones replaced on the mesh but did not free). Runs
  // on a body swap (primitive → glTF) too, resetting `flashing` so the new body
  // re-clones cleanly if a flash is mid-flight across the swap.
  useEffect(
    () => () => {
      for (const m of flashMats.current ?? []) m.dispose();
      flashMats.current = null;
      flashing.current = false;
    },
    [scene],
  );

  useEffect(() => {
    let disposed = false;
    // Materials we clone for the dead-rover dim tint are owned by this placement;
    // dispose them on unmount/reload (the shared cached materials are NOT ours).
    let ownedMats: THREE.Material[] = [];
    loadGLTF(ROVER_MODEL_REF)
      .then((g) => {
        if (disposed) return;
        // clone(true) SHARES the cached source's geometry + materials (Object3D
        // .clone does not deep-copy them), so the clone owns nothing disposable;
        // disposing them would free the cached original and break later rovers.
        // Re-suppress raycast: clone(true) does NOT carry over the own-property
        // raycast override on the cached source, so every placement must re-apply
        // it to keep the model unpickable (the hit-proxy is the SOLE pick target).
        const obj = suppressRaycast(g.clone(true));
        // Normalize the raw NASA model (arbitrary units / off-origin pivot) to a
        // predictable rover size, centered on x/z and seated on y=0.
        fitAndSeatRover(obj, ROVER_MODEL_FIT);
        // Texture fidelity sweep (#100): max anisotropy on every map + correct
        // per-channel colourSpace + crisp data-map mip filtering. Runs BEFORE the
        // dim clone so dead rovers inherit the corrected maps too. Idempotent on
        // the shared cached materials (live rovers re-assert the same fixes).
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        // Dead rover ⇒ darken this placement's materials (clones, so the shared
        // cached materials and live rovers are untouched). Alive ⇒ no-op.
        if (dim) ownedMats = dimRoverModel(obj);
        // Sun shadows (#104): the loaded model's meshes cast + receive the soft
        // sun shadow, like the primitive fallback. clone(true) doesn't carry the
        // flags, so set them per-placement on every mesh in the clone.
        obj.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
          }
        });
        setScene(obj);
        invalidate(); // wake the demand loop once so the model shows when loaded
      })
      .catch((err) => {
        // Missing/failed glTF ⇒ keep the primitive fallback below (never crash),
        // but surface WHY (404 / Draco decode / network) so a box isn't a mystery.
        reportAssetError("rover", ROVER_MODEL_REF, err);
      });
    return () => {
      disposed = true;
      // Free only the materials WE cloned for the dim tint; never the shared
      // cached geometry/materials the clone references.
      for (const m of ownedMats) m.dispose();
    };
  }, [invalidate, dim, gl]);

  if (scene) {
    // The model is pre-normalized (centered x/z, base at y=0), so it just sits at
    // the group origin. It is raycast-suppressed, so it never steals a pick. The
    // wrapping group is the flash traversal root (resurrection body lerp, #107).
    return (
      <group ref={bodyRef}>
        <primitive object={scene} />
      </group>
    );
  }

  // PRIMITIVE fallback (ADR-0004): a low-poly box body on four short cylinder
  // wheels with a sensor mast, monochrome white, dimmed when dead. Every mesh is
  // raycast-suppressed so only the hit-proxy is pickable.
  return (
    <group ref={bodyRef}>
      {/* Body — low-poly box. castShadow/receiveShadow (#104): the rover throws a
          soft sun shadow on the ground and catches shadow from its own mast. */}
      <mesh geometry={geo.body} position={[0, 0.42, 0]} raycast={() => null} castShadow receiveShadow>

        <meshStandardMaterial
          color={bodyColor}
          metalness={0.2}
          roughness={0.7}
          emissive={dim ? "#000000" : "#101014"}
        />
      </mesh>
      {/* Sensor mast block, so the rover reads as front-facing. */}
      <mesh
        geometry={geo.mast}
        position={[0, 0.66, -0.18]}
        raycast={() => null}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={bodyColor} metalness={0.2} roughness={0.7} />
      </mesh>
      {/* Four cylinder wheels. */}
      {(
        [
          [-0.38, -0.42],
          [0.38, -0.42],
          [-0.38, 0.42],
          [0.38, 0.42],
        ] as const
      ).map(([wx, wz], i) => (
        <mesh
          key={i}
          geometry={geo.wheel}
          position={[wx, 0.2, wz]}
          rotation={[0, 0, Math.PI / 2]}
          raycast={() => null}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={dim ? "#141416" : "#3a3a3f"} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

// ---- rover wheel dust (#107) -----------------------------------------------
//
// A short regolith puff kicked up when a rover MOVES — fired BY the snapshot (a
// rover position delta between two snapshots), so it stays a pure function of the
// world and replays deterministically. ~DUST_COUNT faded particles rise and
// settle over DUST_MS via ONE drei <Instances> draw call (mirrors DecorRocks's
// single-draw-call budget), then the burst clears and the loop idles again.
//
// DEMAND-SAFE: nothing animates between bursts. On a move we stamp a burst start
// and invalidate(); the useFrame runs ONLY while a burst is live, keeps the loop
// alive for its ~600ms, then stops invalidating so the scene returns to 0 idle
// fps. Per-particle directions come from a burst-seeded deterministic PRNG
// (decorative jitter, stable for a given rover+burst), so replay is unaffected.

const DUST_COUNT = 15;
const DUST_MS = 600;

// mulberry32 — the same tiny deterministic PRNG DecorRocks uses, so a burst's
// scatter is reproducible (decorative jitter only, never world state).
function dustRand(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DustParticle = {
  // Ground-plane launch direction + speed, plus a small per-particle scale and a
  // phase so the puff doesn't read as a single uniform ring.
  dx: number;
  dz: number;
  speed: number;
  scale: number;
};

// A burst's particles, seeded once per spawn from the rover id so the jitter is
// deterministic. The actual positions/opacity are computed per-frame from the
// burst age in useFrame (no per-frame allocation).
function makeDustParticles(seed: number): DustParticle[] {
  const rand = dustRand(seed);
  const out: DustParticle[] = [];
  for (let i = 0; i < DUST_COUNT; i++) {
    const ang = rand() * Math.PI * 2;
    const speed = 0.5 + rand() * 0.9;
    out.push({
      dx: Math.cos(ang),
      dz: Math.sin(ang),
      speed,
      scale: 0.05 + rand() * 0.07,
    });
  }
  return out;
}

// A stable numeric seed from a rover id string (FNV-1a-ish), so each rover's dust
// scatter is its own but reproducible across replays.
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// RoverDust emits a fading regolith puff each time the rover's snapshot position
// changes. Mounted once per rover (inside its group); it watches `pos` and, on a
// real delta, spawns a burst. The puff is ONE drei <Instances> (a single
// InstancedMesh draw call): we drive each <Instance> child's transform via refs
// and let drei compose the instance matrix. The component owns its invalidation
// so the demand loop wakes for the puff and sleeps again after — no idle
// animation. Non-pickable (the hit-proxy stays the sole pick target).
function RoverDust({ pos }: { pos: Vec2 }) {
  const invalidate = useThree((s) => s.invalidate);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  // Per-instance transform handles (drei PositionMesh = a Group). We mutate these
  // each frame; drei reads them to compose the InstancedMesh matrix.
  const instances = useRef<(THREE.Group | null)[]>([]);
  // Burst state in refs so a spawn never re-renders the React tree.
  const burstStart = useRef<number>(0); // performance.now() of the live burst, 0 = idle
  const particles = useRef<DustParticle[]>([]);
  // Previous snapshot position, to detect a delta. Null until the first snapshot
  // so the rover's FIRST appearance never kicks up dust (only real moves do).
  const prevPos = useRef<Vec2 | null>(null);

  // Detect a position delta on each new snapshot (pos changes only when a new
  // snapshot arrives). A real move spawns a burst; the first render just records
  // the start position. Runs in an effect (post-commit), so it reads the freshest
  // pos and never fires mid-render.
  useEffect(() => {
    const prev = prevPos.current;
    prevPos.current = pos;
    if (!prev) return; // first snapshot for this rover — no dust
    if (prev.X === pos.X && prev.Y === pos.Y) return; // no move — no dust
    // Seed this burst from the rover position so the scatter is deterministic for
    // a given move (decorative jitter, replay-stable).
    const seed = (hashId(`${pos.X},${pos.Y}`) ^ 0x9e3779b9) >>> 0;
    particles.current = makeDustParticles(seed);
    burstStart.current = performance.now();
    invalidate(); // wake the demand loop for the puff
  }, [pos, invalidate]);

  // Animate the live burst: lift + spread each particle and fade the shared
  // material out over DUST_MS, then clear the burst and stop invalidating. Only
  // runs while a burst is live, so between puffs this costs nothing (demand-safe).
  useFrame(() => {
    const start = burstStart.current;
    const mat = matRef.current;
    if (!start || !mat) return;
    const age = (performance.now() - start) / DUST_MS;
    if (age >= 1) {
      // Burst done — collapse every instance to nothing and idle (one final frame
      // draws them hidden, then we stop invalidating → loop returns to 0 fps).
      burstStart.current = 0;
      for (const inst of instances.current) inst?.scale.setScalar(0);
      mat.opacity = 0;
      return; // no invalidate → loop idles
    }
    const ps = particles.current;
    const rise = Math.sin(age * Math.PI) * 0.5; // up then settle
    const spread = age; // outward over the burst
    for (let i = 0; i < ps.length; i++) {
      const inst = instances.current[i];
      if (!inst) continue;
      const p = ps[i];
      inst.position.set(
        p.dx * p.speed * spread,
        0.06 + rise * p.speed,
        p.dz * p.speed * spread,
      );
      inst.scale.setScalar(p.scale * (1 + age)); // puff billows as it fades
      // drei's <Instances> composes the instance matrix from each child's
      // matrixWorld in its own useFrame; force it current NOW so the puff tracks
      // this frame's transform instead of lagging one frame behind.
      inst.updateMatrixWorld();
    }
    mat.opacity = 0.5 * (1 - age); // fade out
    invalidate(); // keep the loop alive while the puff animates
  });

  // ONE InstancedMesh for the whole puff (one draw call). frames={Infinity} so
  // drei re-composes the instance matrix from our mutated <Instance> transforms
  // on every rendered frame — but the loop only renders while WE invalidate above,
  // so it stays demand-safe. Starts collapsed (scale 0, opacity 0); raycast-
  // suppressed so it never steals a pick.
  return (
    <Instances limit={DUST_COUNT} raycast={() => null}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshStandardMaterial
        ref={matRef}
        color="#b8ac9c"
        roughness={1}
        metalness={0}
        transparent
        opacity={0}
        depthWrite={false}
      />
      {Array.from({ length: DUST_COUNT }, (_, i) => (
        <Instance
          key={i}
          ref={(el: THREE.Group | null) => (instances.current[i] = el)}
          scale={0}
        />
      ))}
    </Instances>
  );
}

// ---- a single rover --------------------------------------------------------

type Rover3DProps = {
  rover: RoverView;
  map: SceneMap;
  geo: SceneGeo;
  selected: boolean;
  beats: React.RefObject<ActiveBeat[]>; // live beat list, read in useFrame
  onPick: (id: string) => void;
};

// A rover built from PRIMITIVE geometry (ADR-0004 fallback): a low-poly box body
// on four short cylinder wheels, monochrome white per the brand's no-accent
// rule, dimmed when dead. A generous INVISIBLE hit-proxy sphere wraps it so the
// click raycast reliably selects the rover the user sees — the proxy uses the
// SAME world→scene map as the rendered body, so the hit can never drift (the 3D
// analogue of the 2D canvas's shared-projection guarantee).
//
// The bid-flash and winner-glow are animated by mutating refs in useFrame
// (below), NOT by re-rendering — this component only re-renders when its
// snapshot-derived props change (~12 Hz), never per animation frame.
function Rover3D({ rover, map, geo, selected, beats, onPick }: Rover3DProps) {
  const p = map.at(rover.pos);
  const dim = !rover.alive;
  const haloColor = roverHaloColor(rover);

  const haloRef = useRef<THREE.Mesh>(null);
  const haloMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const wonRef = useRef<THREE.Mesh>(null);
  const wonMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const revivedRef = useRef<THREE.Mesh>(null);
  const revivedMatRef = useRef<THREE.MeshStandardMaterial>(null);
  // Live "revived" beat progress (0 = none, →1 = fading), written each frame in
  // useFrame and read by RoverBody so the body itself does the grey→bright lerp
  // of the resurrection shockwave (#107) without re-rendering.
  const revivedProgress = useRef<number>(0);

  // Put the status halo + winner ring + recovery pulse on the bloom layer so ONLY
  // they glow. Once on mount — the meshes are stable across re-renders.
  useEffect(() => {
    haloRef.current?.layers.enable(HALO_BLOOM_LAYER);
    wonRef.current?.layers.enable(HALO_BLOOM_LAYER);
    revivedRef.current?.layers.enable(HALO_BLOOM_LAYER);
  }, []);

  // Animate the bid-flash (halo pulse + amber) and the winner glow by mutating
  // the meshes directly. Reads the live beat list every frame — but the loop is
  // demand-driven, so this only runs while a render is invalidated (i.e. while
  // beats are active or the user is interacting).
  const id = rover.id;
  useFrame(() => {
    const list = beats.current;
    if (!list) return;
    const now = performance.now();
    let bid = 0;
    let won = 0;
    let revived = 0;
    for (const b of list) {
      if (b.robot_id !== id) continue;
      if (b.kind === "bid") bid = beatProgress(b, now);
      else if (b.kind === "won") won = beatProgress(b, now);
      else if (b.kind === "revived") revived = beatProgress(b, now);
    }
    // Share the revived progress with RoverBody (the body color lerp half of the
    // resurrection shockwave). Written every frame so it tracks the beat exactly.
    revivedProgress.current = revived;

    // Bid-war strobe (#107): when MULTIPLE rovers are bidding at once (auction
    // contention), every contending rover's halo strobes faster + harder than the
    // lone-bid flash. A pure read of the live beats (activeBidders/bidWarStrobe),
    // so the strobe stays deterministic; 0 when only this rover bids.
    const strobe = bid > 0 ? bidWarStrobe(activeBidders(list, now)) : 0;

    const halo = haloRef.current;
    const haloMat = haloMatRef.current;
    if (halo && haloMat) {
      // Base bid flash: a single half-sine swell over the beat. During contention,
      // overlay a fast strobe (≈10 Hz) whose depth scales with the number of
      // bidders, so a tug-of-war reads as a frantic flicker, not a calm pulse.
      const basePulse = bid > 0 ? Math.sin(bid * Math.PI) * 0.35 : 0;
      const strobePulse =
        strobe > 0 ? (0.5 + 0.5 * Math.sin(now * 0.063)) * strobe * 0.4 : 0;
      halo.scale.setScalar(1 + basePulse + strobePulse);
      const c = bid > 0 ? SIGNAL_WARN : haloColor;
      haloMat.color.set(c);
      haloMat.emissive.set(c);
      // Spike the halo's own emissive during contention so the strobe also pumps
      // brightness (and, via the bloom layer, the selective-bloom glow).
      haloMat.emissiveIntensity = (dim ? 1.4 : 2.2) + strobePulse * 3.0;
    }

    const wonMesh = wonRef.current;
    const wonMat = wonMatRef.current;
    if (wonMesh && wonMat) {
      if (won > 0) {
        wonMesh.visible = true;
        wonMesh.scale.setScalar(1 + won * 1.6);
        wonMat.opacity = 1 - won;
        wonMat.emissiveIntensity = 2.4 * (1 - won);
      } else if (wonMesh.visible) {
        wonMesh.visible = false;
      }
    }

    // Recovery pulse — a wide cyan shockwave on a "revived" beat, marking the
    // in-place comeback before the rover holds station then drives off. Bigger
    // and brighter than the winner ring so the recovery reads as its own beat.
    const revMesh = revivedRef.current;
    const revMat = revivedMatRef.current;
    if (revMesh && revMat) {
      if (revived > 0) {
        revMesh.visible = true;
        revMesh.scale.setScalar(1 + revived * 2.8);
        revMat.opacity = 1 - revived;
        revMat.emissiveIntensity = 3.0 * (1 - revived);
      } else if (revMesh.visible) {
        revMesh.visible = false;
      }
    }
  });

  // The selection halo is the clear KILL-target affordance, mirroring the 2D
  // canvas: danger-red around a live rover, muted around a dead one.
  const selColor = dim ? SIGNAL_IDLE : SIGNAL_DOWN;

  const battery = batteryPercent(rover.battery);
  const batteryColor = dim
    ? "#555"
    : battery > 50
      ? SIGNAL_OK
      : battery > 20
        ? SIGNAL_WARN
        : SIGNAL_DOWN;

  return (
    // The group is PLACED by map.at (world position) and SCALED to the rover's
    // literal real-world size (Epic 04 P0): every child — the hit-proxy, the body,
    // the halos/rings, dust, battery — scales together by ROVER_SCALE, so the
    // proxy still exactly covers the visible body (ADR-0004 no-missed-click) and
    // the affordances stay proportional to the (now real-sized) rover.
    <group position={[p.x, p.y, p.z]} scale={ROVER_SCALE}>
      {/* Invisible, generous hit-proxy. Larger than the visible body so clicks
          reliably land; shares this group's transform (= map.at · ROVER_SCALE), so
          the raycast hit and the rendered rover are positioned + sized by the exact
          same math. */}
      <mesh
        geometry={geo.hit}
        position={[0, 0.45, 0]}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation(); // empty-space deselect is handled by the ground
          onPick(rover.id);
        }}
        onPointerOver={() => (document.body.style.cursor = "pointer")}
        onPointerOut={() => (document.body.style.cursor = "default")}
      >
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Body — the realistic rover glTF (#54), with the PRIMITIVE box + mast +
          wheels as the FOREVER fallback until/if the model loads. Both are
          raycast-suppressed so the hit-proxy above stays the SOLE pick target. */}
      <RoverBody geo={geo} dim={dim} revived={revivedProgress} />

      {/* Wheel dust (#107) — a regolith puff kicked up when this rover MOVES
          (a snapshot position delta). Demand-safe: it animates only during a
          burst, then idles. Lives in the rover group so the puff follows it. */}
      <RoverDust pos={rover.pos} />

      {/* Status halo — a thin ring on the ground under the rover. This is the
          ONLY rover element on the bloom layer, so the glow is confined to it.
          Uses an emissive, non-tone-mapped material so it reads as "lit". Color
          + scale are mutated in useFrame (the bid-flash) without re-rendering. */}
      <mesh
        ref={haloRef}
        geometry={geo.halo}
        position={[0, 0.04, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={haloMatRef}
          color={haloColor}
          emissive={haloColor}
          emissiveIntensity={dim ? 1.4 : 2.2}
          toneMapped={false}
          transparent
          opacity={dim ? 0.7 : 0.95}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Winner glow — an expanding ring on a "won" beat (the auction winner).
          Always mounted but hidden; visibility/scale/opacity are driven in
          useFrame so it costs nothing to keep around between beats. */}
      <mesh
        ref={wonRef}
        geometry={geo.won}
        position={[0, 0.05, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={wonMatRef}
          color={SIGNAL_OK}
          emissive={SIGNAL_OK}
          emissiveIntensity={0}
          toneMapped={false}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Recovery pulse — an expanding cyan ring on a "revived" beat (the rover's
          in-place comeback). Reuses the winner ring geometry; hidden until the
          beat drives it in useFrame. */}
      <mesh
        ref={revivedRef}
        geometry={geo.won}
        position={[0, 0.055, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
        raycast={() => null}
      >
        <meshStandardMaterial
          ref={revivedMatRef}
          color={SIGNAL_REVIVE}
          emissive={SIGNAL_REVIVE}
          emissiveIntensity={0}
          toneMapped={false}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Selection halo — the KILL-target affordance (NOT on the bloom layer, so
          it stays a crisp outline rather than a glow). */}
      {selected ? (
        <mesh
          geometry={geo.sel}
          position={[0, 0.06, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          raycast={() => null}
        >
          <meshBasicMaterial color={selColor} transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      ) : null}

      {/* Battery tick: a short bar whose color encodes charge (functional). A
          shared unit box scaled in x, so charge changes never reallocate. */}
      <mesh
        geometry={geo.battery}
        position={[0, 0.92, 0]}
        scale={[0.5 * (battery / 100) + 0.02, 1, 1]}
        raycast={() => null}
      >
        <meshStandardMaterial
          color={batteryColor}
          emissive={batteryColor}
          emissiveIntensity={0.6}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ---- a lease beam (rover → held task) --------------------------------------

// A dashed green beam from a rover to the task it holds, mirroring the 2D
// canvas. Derived purely from the snapshot (rover.task → task.pos). The beam is
// "severed" on a kill beat by simply not rendering once the rover is dead/has no
// task — the snapshot drives it, so an orphaned task's beam vanishes on its own.
// Uses drei's <Line> (the bare three.js <line> JSX collides with SVG typings).
function LeaseBeam({ from, to, map }: { from: RoverView; to: TaskView; map: SceneMap }) {
  const a = map.at(from.pos, 0.42);
  const b = map.at(to.pos, tierHeight(tierOf(to.type)));
  const points = useMemo<[number, number, number][]>(
    () => [
      [a.x, a.y, a.z],
      [b.x, b.y, b.z],
    ],
    [a.x, a.y, a.z, b.x, b.y, b.z],
  );
  return (
    <Line
      points={points}
      color={SIGNAL_OK}
      lineWidth={2}
      dashed
      dashSize={0.3}
      gapSize={0.2}
      transparent
      opacity={0.85}
      raycast={() => null}
    />
  );
}

// ---- Build-spec mesh: primitive (optionally textured) or glTF model ---------
//
// bh-07b: the Build spec's forward-compatible slots become REAL. A primitive op
// may carry a CC0 texture (material.map); a "model" op references a CC0 glTF
// (model_ref). Both load asynchronously and FALL BACK to plain geometry on any
// miss, so the scene is never broken by a gone/slow asset (ADR-0004 — the scene
// stays a pure function of the snapshot, the renderer only INTERPRETS data).

// One shared GLTFLoader + a tiny module-level cache, so N tasks referencing the
// same .glb parse it ONCE (r3f-geometry "reuse"), and the parsed scene is cloned
// per placement so transforms/materials never cross-contaminate.
const gltfLoader = new GLTFLoader();
// Self-hosted Draco + meshopt decoders so conditioned (compressed) .glb load
// OFFLINE — no gstatic CDN fetch (the projector may have no network). The
// decoder files live in web/public/draco/ and are served from the same origin;
// '/draco/' is where DRACOLoader looks for draco_wasm_wrapper.js +
// draco_decoder.wasm (the glTF decoder variant vendored from three's examples).
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath("/draco/");
gltfLoader.setDRACOLoader(dracoLoader);
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const gltfCache = new Map<string, Promise<THREE.Group>>();

// Exported so the preload pass (lib/assets.ts) can WARM this exact module-level
// cache — preloading a rover/spec GLB through here means the descent reuses the
// already-decoded model with zero rework (Epic 05 P1).
export function loadGLTF(url: string): Promise<THREE.Group> {
  let p = gltfCache.get(url);
  if (!p) {
    p = new Promise<THREE.Group>((resolve, reject) => {
      gltfLoader.load(
        url,
        (g) => {
          try {
            // Suppress raycast on every child of the CACHED SOURCE once. This keeps
            // the source itself non-pickable and documents the asset-wide intent.
            // NOTE: Object3D.clone(true) does NOT copy this own-property override
            // onto clones (raycast is normally a prototype method), so each
            // placement must ALSO re-suppress its clone — see suppressRaycast() use
            // in SpecModel. Doing both keeps glTF child meshes unpickable so only a
            // rover's invisible hit-proxy sphere stays pickable, keeping
            // click-to-kill deterministic and letting onPointerMissed deselect on
            // empty space.
            suppressRaycast(g.scene);
            // Material tier polish (#111): clearcoat on metal, solar glint when the
            // URL names a panel, warm emissive on *window* submeshes (bloom layer).
            // Run ONCE on the cached source so every clone inherits it (clone(true)
            // shares materials + copies the per-mesh layers mask).
            polishGltfMaterials(g.scene, { bloomLayer: CELESTIAL_BLOOM_LAYER, url });
          } catch (err) {
            // Decorate/polish must NEVER reject: this promise is already in
            // gltfCache, so a rejection caches the FAILURE and poisons every later
            // consumer into a permanent primitive fallback (#171 — a single
            // material throw blanked every rover). Log it and resolve the raw,
            // un-polished model — a slightly-less-shiny model beats a box forever.
            reportAssetError("glTF polish", url, err);
          }
          resolve(g.scene);
        },
        undefined,
        (err) => reject(err instanceof Error ? err : new Error(String(err))),
      );
    });
    gltfCache.set(url, p);
  }
  return p;
}

// SpecPrimitive draws one primitive op. If the op declares any PBR texture maps
// (issue #53: map / normalMap / roughnessMap / aoMap), it loads each via
// TextureLoader and applies it once ready; a load failure simply leaves the flat
// color for that channel (the scene never breaks). colorSpace is set per map:
// the diffuse map is sRGB; normal/roughness/ao are linear (NoColorSpace) — drei
// does NOT auto-set this on three 0.169, so getting it wrong skews lighting.
// aoMap relies on the spec geometries carrying a uv2 channel (see withUV2). All
// textures load on mount and are disposed on unmount.
function SpecPrimitive({
  desc,
  geo,
  color,
  opacity,
  built,
}: {
  desc: PrimitiveDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
  // Sun shadows (#104): a built op casts/receives the soft sun shadow; a
  // transparent ghost op does not, so unfinished blueprints don't throw solid
  // shadows. Defaults true for the model fallback, which is itself only a built op.
  built?: boolean;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    // The PBR channels to load, paired with the material slot and the correct
    // colorSpace: diffuse is sRGB, the data maps (normal/roughness/ao) are linear.
    const slots: {
      url: string | undefined;
      key: "map" | "normalMap" | "roughnessMap" | "aoMap";
      colorSpace: THREE.ColorSpace;
    }[] = [
      { url: desc.map, key: "map", colorSpace: THREE.SRGBColorSpace },
      { url: desc.normalMap, key: "normalMap", colorSpace: THREE.NoColorSpace },
      { url: desc.roughnessMap, key: "roughnessMap", colorSpace: THREE.NoColorSpace },
      { url: desc.aoMap, key: "aoMap", colorSpace: THREE.NoColorSpace },
    ];
    let disposed = false;
    for (const slot of slots) {
      // A slot with no URL is explicitly cleared so a re-render that DROPS a map
      // (this mesh's index now folds a different op) doesn't keep a stale texture.
      if (!slot.url) {
        if (matRef.current && matRef.current[slot.key]) {
          matRef.current[slot.key] = null;
          matRef.current.needsUpdate = true;
        }
        continue;
      }
      // Shared URL-keyed cache (textureCache): one decoded texture per URL, shared
      // with the preload pass so the descent shows no pop-in. The cache OWNS the
      // texture (we never dispose it). colorSpace is per-URL config applied here.
      const url = slot.url;
      const t = loadTexture(url);
      t.colorSpace = slot.colorSpace;
      void preloadTexture(url).then(() => {
        if (disposed || !matRef.current) return;
        if (!t.image) return; // failed load ⇒ keep the flat colour (ADR-0004)
        matRef.current[slot.key] = t;
        matRef.current.needsUpdate = true;
        invalidate(); // wake the demand loop so the texture shows
      });
    }
    const mat = matRef.current;
    return () => {
      disposed = true;
      // The cache owns the textures (shared, session-lived) — do NOT dispose them.
      // Detach our textures from the material so a re-render never leaves a stale
      // slot pointing at a texture this op no longer uses.
      if (mat) {
        for (const slot of slots) {
          if (!slot.url) continue;
          if (mat[slot.key] === loadTexture(slot.url)) mat[slot.key] = null;
        }
      }
    };
  }, [desc.map, desc.normalMap, desc.roughnessMap, desc.aoMap, invalidate]);

  const geometry =
    desc.geometry === "box"
      ? geo.specBox
      : desc.geometry === "cylinder"
        ? geo.specCylinder
        : geo.specSphere;

  return (
    <mesh
      geometry={geometry}
      position={desc.position}
      rotation={desc.rotation}
      scale={desc.scale}
      raycast={() => null}
      castShadow={built !== false}
      receiveShadow={built !== false}
    >
      <meshStandardMaterial
        ref={matRef}
        color={color}
        roughness={desc.roughness}
        metalness={desc.metalness}
        transparent
        opacity={opacity}
        emissive="#000000"
        emissiveIntensity={0}
        toneMapped={false}
      />
    </mesh>
  );
}

// SpecModel places a CC0 glTF model (model_ref, bh-07b). It loads the .glb on
// mount; until it resolves — and FOREVER if it fails — it renders the descriptor's
// box fallback, so the structure is always present and the scene stays a pure
// function of the snapshot. The loaded scene is cloned so each placement is
// independent; the clone is disposed on unmount.
function SpecModel({
  desc,
  geo,
  color,
  opacity,
  built,
}: {
  desc: ModelDesc;
  geo: SceneGeo;
  color: string;
  opacity: number;
  built: boolean;
}) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    let disposed = false;
    loadGLTF(desc.modelRef)
      .then((g) => {
        if (disposed) return;
        // clone(true) SHARES the source geometry + materials with the cached glTF
        // (Object3D.clone does not deep-copy them), so the clone owns nothing
        // disposable — disposing its geometry/material would free the cached
        // original and break every later placement of the same asset. The cached
        // glTF lives for the session and is reclaimed on page unload; we only
        // clone so each placement gets its own transform node.
        // Re-suppress raycast on this clone: clone(true) does not carry over the
        // own-property override applied to the cached source, so every placement
        // must re-apply it to stay non-pickable (see suppressRaycast / loadGLTF).
        const obj = suppressRaycast(g.clone(true));
        // Sun shadows (#104): a built op's model casts + receives the soft sun
        // shadow. clone(true) doesn't carry the flags, so set them per-placement.
        if (built) {
          obj.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
        }
        // Texture fidelity sweep (#100): max anisotropy + per-channel colourSpace
        // + crisp data-map mip filtering on the model's materials. Idempotent on
        // the shared cached materials (every placement re-asserts the same fixes).
        applyGltfTextureFidelity(obj, gl.capabilities.getMaxAnisotropy());
        setScene(obj);
        invalidate();
      })
      .catch((err) => {
        // Missing/failed glTF ⇒ keep the box fallback below (never crash), but
        // log WHICH spec model ref failed so a stray box has a traceable cause.
        reportAssetError("spec model", desc.modelRef, err);
      });
    return () => {
      disposed = true;
    };
  }, [desc.modelRef, invalidate, built, gl]);

  if (!scene) {
    // Fallback primitive (a box at the op's transform) until/if the glTF loads.
    return (
      <SpecPrimitive desc={desc.fallback} geo={geo} color={color} opacity={opacity} built={built} />
    );
  }

  return (
    <primitive
      object={scene}
      position={desc.position}
      rotation={desc.rotation}
      scale={desc.scale}
    />
  );
}

// SpecMesh dispatches one descriptor to the primitive or model renderer. Built
// tasks show the op's own color; an unfinished interpreted task ghosts in the
// shared status color (so it reads like the primitive ghost).
function SpecMesh({
  desc,
  geo,
  built,
  ghostColor,
  opacity,
}: {
  desc: MeshDesc;
  geo: SceneGeo;
  built: boolean;
  ghostColor: string;
  opacity: number;
}) {
  const color = built ? desc.color : ghostColor;
  if (desc.kind === "model") {
    return <SpecModel desc={desc} geo={geo} color={color} opacity={opacity} built={built} />;
  }
  return <SpecPrimitive desc={desc} geo={geo} color={color} opacity={opacity} built={built} />;
}

// ---- a task / dome block ----------------------------------------------------

// Each task is a block in the rising habitat: foundations form the base, walls
// the mid ring, the dome task the cap. A DONE task is "built" (solid, lit by a
// brief solidify pop); a not-yet-done task is a faint ghost of the structure to
// come. Position + height come from lib/scene.ts — a pure read of the snapshot.
// The solidify pop (scale + green flash) is animated in useFrame by mutating
// refs, so a completing block never forces a scene re-render.
function TaskBlock({
  task,
  map,
  geo,
  beats,
}: {
  task: TaskView;
  map: SceneMap;
  geo: SceneGeo;
  beats: React.RefObject<ActiveBeat[]>;
}) {
  const tier = tierOf(task.type);
  const h = tierHeight(tier);
  const p = map.at(task.pos, 0);
  const built = isBuilt(task);

  const color = built ? "#cfcfd6" : task.status === "LEASED" ? SIGNAL_WARN : SIGNAL_IDLE;
  // WS-1 (#169): at rest an UNCLAIMED task is a faint *scribe* of the structure to
  // come — a build affordance, not set dressing. Drop it to a barely-there outline
  // (opacity 0.10, was 0.28) and shrink it, so the resting worksite reads as clean
  // regolith with a planned footprint rather than a field of solid translucent
  // boxes + a ghost dome. LEASED (in-progress) and DONE (built) render unchanged.
  const isUnclaimedGhost = !built && task.status === "UNCLAIMED";
  const opacity = built ? 1 : task.status === "LEASED" ? 0.5 : 0.1;
  const ghostScale = isUnclaimedGhost ? 0.82 : 1;

  // The dome cap reads as a hemisphere; foundations/walls as low blocks.
  const isCap = tier === "dome";
  const blockGeo = isCap ? geo.dome : tier === "foundation" ? geo.foundation : geo.wall;

  // Per-tier roughness (#111): the polished pressurised cap reads smoothest, the
  // walls matte fabric/panel, the foundation roughest poured regolith-crete — so
  // the rising habitat reads as distinct materials, not one uniform grey block.
  const tierRoughness = isCap ? 0.75 : tier === "foundation" ? 0.95 : 0.88;

  // Interpret the Task's Build spec (ADR-0006), if any, into renderable meshes.
  // EMPTY ⇒ the Task has no (renderable) spec, so we render EXACTLY today's
  // primitive — the fallback this slice must keep pixel-identical. Memoized on
  // the spec identity so the pure pass stays allocation-light (~12 Hz snapshots).
  const specMeshes = useMemo<MeshDesc[]>(
    () => interpretBuildSpec(task),
    [task],
  );
  const interpreted = specMeshes.length > 0;

  // Solidify-pop refs. The PRIMITIVE path animates its single mesh + material
  // EXACTLY as before (meshRef/matRef). The INTERPRETED path has no single
  // material to flash, so it pops the whole structure group (groupRef) by scale
  // alone, keeping each op's procedural material intact. Only one path's refs are
  // populated per render, so the unused branch is a harmless no-op.
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);

  const id = task.id;
  useFrame(() => {
    const list = beats.current;
    let solidify = 0;
    if (list) {
      const now = performance.now();
      for (const b of list) {
        if (b.kind === "solidify" && b.task_id === id) {
          solidify = beatProgress(b, now);
          break;
        }
      }
    }
    // ghostScale folds the WS-1 UNCLAIMED shrink into the same scale channel as
    // the solidify pop, so a faint resting ghost reads ~0.82 and a completing
    // block still pops from there (UNCLAIMED tasks never carry a solidify beat).
    const popScale = (solidify > 0 ? 1 + Math.sin(solidify * Math.PI) * 0.25 : 1) * ghostScale;

    // Interpreted structure: pop the group (scale only — procedural mats stay).
    if (groupRef.current) groupRef.current.scale.setScalar(popScale);

    // Primitive: pop the single mesh + green-flash its material (unchanged).
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (mesh && mat) {
      mesh.scale.setScalar(popScale);
      if (solidify > 0) {
        mat.emissive.set(SIGNAL_OK);
        mat.emissiveIntensity = 1.5 * (1 - solidify);
      } else if (mat.emissiveIntensity !== 0) {
        mat.emissiveIntensity = 0;
      }
    }
  });

  // WS-1 follow-up: at rest, an UNCLAIMED habitat dome cap shows up as a solid
  // dark blob squatting over the worksite — the "pre-placed blueprint preview"
  // the surface overhaul set out to kill (milestone 08, complaint #5). Two paths
  // feed it, so we close both:
  //   • the primitive dome-tier cap (geo.dome hemisphere), and
  //   • the INTERPRETED build-spec model (model_ref) — and crucially the ghost
  //     OPACITY fade only reaches primitive ghosts; a loaded model ignores it and
  //     renders SOLID (we confirmed dark #262626 caps at opacity 1 live), which is
  //     why only the domes read as solid blobs while the walls fade to a scribe.
  // Drop the resting cap/model ghost entirely; it reappears the instant its task
  // is LEASED (build begins) and rises for real. Primitive foundations/walls keep
  // their faint footprint scribe, so the planned footprint still reads at rest.
  if (isUnclaimedGhost && (isCap || interpreted)) return null;

  // INTERPRETED PATH — the richer structure. Each op is drawn by <SpecMesh>,
  // which renders a primitive (optionally textured, bh-07b) or a glTF model
  // (model_ref, bh-07b) with a primitive fallback. The group sits at the same
  // ground point as the primitive; built/ghost opacity is shared so an unfinished
  // interpreted Task still reads as a ghost, like the primitive.
  if (interpreted) {
    return (
      <group ref={groupRef} position={[p.x, 0, p.z]}>
        {specMeshes.map((m, i) => (
          <SpecMesh
            key={i}
            desc={m}
            geo={geo}
            built={built}
            ghostColor={color}
            opacity={opacity}
          />
        ))}
      </group>
    );
  }

  // PRIMITIVE FALLBACK — EXACTLY today's tierOf block (unchanged).
  return (
    <group position={[p.x, 0, p.z]}>
      {/* castShadow/receiveShadow only once BUILT (#104): a transparent blueprint
          ghost shouldn't throw a solid sun shadow — it grounds only when finished. */}
      <mesh
        ref={meshRef}
        geometry={blockGeo}
        position={[0, h, 0]}
        raycast={() => null}
        castShadow={built}
        receiveShadow={built}
      >
        <meshStandardMaterial
          ref={matRef}
          color={color}
          roughness={tierRoughness}
          metalness={0.05}
          transparent
          opacity={opacity}
          emissive="#000000"
          emissiveIntensity={0}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ---- lunar terrain ----------------------------------------------------------

// The CC0 regolith PBR set (Poly Haven "Moon 01", 512 jpg) tiled over the ground.
// Self-hosted under web/public so it works offline; see public/assets/CREDITS.md.
// Exported so the preload manifest (lib/assets.ts) references the SAME terrain
// URLs the renderer tiles — the manifest can't drift from the component (Epic 05 P1).
export const REGOLITH_MAPS: {
  url: string;
  key: "map" | "normalMap" | "roughnessMap" | "aoMap";
  colorSpace: THREE.ColorSpace;
}[] = [
  // WS-4 (#170): upgraded 512 → 2K (Poly Haven Moon 01, CC0). The heavy normal/AO
  // maps are re-encoded at jpg q68 so the full set lands ≈5 MB (vs ~10 MB raw) while
  // keeping true 2048² near-field crunch. Tiled grain is broken by the macro-variation
  // shader below, not by resolution. (Small spec-primitive blocks still use the 512
  // set via mocks — they don't need 2K.)
  { url: "/assets/textures/regolith_diff_2k.jpg", key: "map", colorSpace: THREE.SRGBColorSpace },
  {
    url: "/assets/textures/regolith_nor_gl_2k.jpg",
    key: "normalMap",
    colorSpace: THREE.NoColorSpace,
  },
  {
    url: "/assets/textures/regolith_rough_2k.jpg",
    key: "roughnessMap",
    colorSpace: THREE.NoColorSpace,
  },
  { url: "/assets/textures/regolith_ao_2k.jpg", key: "aoMap", colorSpace: THREE.NoColorSpace },
];

// The VISIBLE ground extends FAR past the worksite so its edge falls beyond the
// horizon and (with the surface fog) dissolves into the black sky — it reads as an
// endless regolith plain, not a platform. This is purely the terrain MESH size;
// the world→scene projection still uses GROUND_SPAN (=20) so rover/task placement
// is unchanged. Worksite detail lives in the central ~±16 units; the rest is plain.
const GROUND_VISUAL = 700;

// Tile count across the visible ground. Scaled WITH the ground size so the regolith
// grain stays the same size whether the plane is 32 or 700 units (Moon 01 is authored
// to tile). WS-4 (#170): factor 0.3 → 0.22 — with the new 2K maps each tile can cover
// more ground (larger, more natural boulder-field grain) and still stay crisp, and the
// lower repeat frequency is easier for the macro-variation shader to hide. Tune if
// grain reads too large/small.
const REGOLITH_REPEAT = Math.round(GROUND_VISUAL * 0.22);

// WS-4 (#170) anti-tiling. A regolith map tiled ~150× over the ground reads as an
// obvious repeating grid — the classic "this is a tiled texture" tell. We break it
// with a MACRO-VARIATION pass injected into the MeshStandard shader: a large-scale
// (tens-of-units) procedural value-noise modulates the albedo brightness + a touch of
// roughness, so meter-scale light/dark blotches drift across the surface and the tile
// seams stop reading as a lattice. Pure shader math — no extra texture, no draw call,
// runs entirely on the GPU. World-space sampled so the variation is stable as the
// camera moves (it's "painted on the ground", not screen-space).
const REGOLITH_MACRO_VERT_DECL = `varying vec3 vRegoWPos;`;
const REGOLITH_MACRO_VERT_ASSIGN = `vRegoWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const REGOLITH_MACRO_FRAG_DECL = `
varying vec3 vRegoWPos;
float regoHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float regoVN(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = regoHash(i), b = regoHash(i + vec2(1.0, 0.0));
  float c = regoHash(i + vec2(0.0, 1.0)), d = regoHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Two octaves of low-frequency world-space noise → broad blotches (~30 u) plus a
// finer drift (~12 u). Returns ~[0,1] centred near 0.5.
float regoMacro(vec2 wxz){
  return regoVN(wxz * 0.034) * 0.62 + regoVN(wxz * 0.11 + 17.3) * 0.38;
}`;

// Deterministic 2D value noise (#105): a cheap integer-lattice hash plus
// bilinear interpolation with a smoothstep fade. No asset, no RNG state — the
// same (x, y) always returns the same value, so the terrain stays a pure
// function of its geometry (built once, never per-frame). Used for a
// high-frequency micro-relief octave on top of the smooth sine swells so the
// close-up surface reads as chaotic regolith rather than rolling dunes.
function hashLattice(ix: number, iy: number): number {
  const h = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return h - Math.floor(h); // [0, 1)
}

function valueNoise2(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep fade → C1-continuous, no faceting between lattice cells.
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashLattice(ix, iy);
  const b = hashLattice(ix + 1, iy);
  const c = hashLattice(ix, iy + 1);
  const d = hashLattice(ix + 1, iy + 1);
  const top = a + (b - a) * ux;
  const bottom = c + (d - c) * ux;
  return top + (bottom - top) * uy; // [0, 1)
}

// Low-poly lunar ground: a single displaced plane primitive (ADR-0004 allows a
// "simple ground plane / displaced primitive"). Static — built once, not driven
// by the snapshot. Subtle deterministic vertex displacement gives a regolith
// feel, and a tiling CC0 regolith PBR set (issue #53) clothes it. A missing/
// failed texture leaves the flat fallback color, so the scene never breaks.
// Inject the WS-4 macro-variation into a MeshStandardMaterial's compiled shader.
// Hooks the stock chunks: declare a world-pos varying, fill it in begin_vertex, then
// after map_fragment modulate albedo and after roughnessmap_fragment nudge roughness.
// Average multiplier ≈1.0 (centred), so it adds texture without darkening the surface.
function applyRegolithMacro(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${REGOLITH_MACRO_VERT_DECL}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>\n  ${REGOLITH_MACRO_VERT_ASSIGN}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n${REGOLITH_MACRO_FRAG_DECL}`)
    .replace(
      "#include <map_fragment>",
      `#include <map_fragment>\n  { float m = regoMacro(vRegoWPos.xz); diffuseColor.rgb *= mix(0.82, 1.18, m); }`,
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `#include <roughnessmap_fragment>\n  roughnessFactor *= mix(0.94, 1.06, regoMacro(vRegoWPos.xz));`,
    );
}

function LunarTerrain({
  terrainTint,
  crater = false,
  skylight = false,
}: {
  terrainTint: string;
  crater?: boolean;
  skylight?: boolean;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const geom = useMemo(() => {
    // Shackleton's carved crater needs a finer mesh than the flat lunar plain: at
    // 96 segments a 700-unit plane is ~7.3 units/quad, too coarse for a clean rim
    // crest. Bump to 220 (≈3.2 units/quad) ONLY when the crater is on — still a
    // single mesh / single draw call (the only hygiene budget post-ADR-0004), and
    // the one-time rebuild happens behind the site-swap dust veil. The lunar
    // skylight collar (#173) is shallow + small, but bump lunar to 160 (≈4.4
    // u/quad) when it's on so the recessed rim reads smooth, not stepped.
    const seg = crater ? 220 : skylight ? 160 : 96;
    const g = new THREE.PlaneGeometry(GROUND_VISUAL, GROUND_VISUAL, seg, seg);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // Plane-local (x, y) maps to scene (x, -z) after the -90° rotation, so
      // hypot(x, y) is the scene-radius from the worksite origin — the same radius
      // the crater profile (and the worksite recenter) use.
      const r = Math.hypot(x, y);
      // Deterministic pseudo-noise (sines): fine regolith ripple everywhere, plus a
      // long, low rolling swell that fades IN with distance from the worksite so the
      // far plain undulates toward the horizon while the center (where rovers/tasks
      // sit at y=0) stays flat. No physics, no asset.
      const fine = Math.sin(x * 0.6) * Math.cos(y * 0.55) * 0.18 + Math.sin(x * 1.7 + y) * 0.05;
      const swellAmp = THREE.MathUtils.smoothstep(r, 30, 200) * 4.0;
      const swell = Math.sin(x * 0.018 + 1.3) * Math.cos(y * 0.021) * swellAmp;
      // High-frequency micro-relief octave (#105): two value-noise layers near the
      // mesh's Nyquist limit (~7.3 units/vertex) break the smooth sine dunes into
      // chaotic, irregular bumps so the close-up surface reads as fine regolith.
      // Centered to ±1 so it adds no net rise — rovers/tasks at y=0 stay grounded.
      // Slightly attenuated right under the worksite (<6 units) to keep that floor
      // readable, then full strength outward across the visible plain.
      const microMask = 0.55 + 0.45 * THREE.MathUtils.smoothstep(r, 4, 12);
      const micro =
        ((valueNoise2(x * 0.31, y * 0.31) - 0.5) * 0.16 +
          (valueNoise2(x * 0.73 + 19.3, y * 0.73 - 7.1) - 0.5) * 0.07) *
        microMask;
      // Shackleton crater (carved at the worksite origin — siteMap recenters the
      // worksite there). Suppress the rolling swell INSIDE the rim so it can't
      // corrugate the clean bowl wall; keep fine ripple + micro grain on the floor
      // and walls. The crater delta lifts a rim ring around the y≈0 floor.
      // Lunar lava-tube skylight (#173): carve a recessed collar + raised ejecta
      // rim around an offset centre. Distance from the skylight centre, computed in
      // SCENE space — plane-local (x, y) maps to scene (x, -y), so scene-z = -y.
      let skyTerm = 0;
      let skyWall = 1; // 1 = open plain, → 0 inside the collar (damps swell/micro)
      if (skylight) {
        const sdr = Math.hypot(x - SKYLIGHT_CENTER[0], -y - SKYLIGHT_CENTER[1]);
        if (sdr < SKYLIGHT_OUTER_RADIUS) {
          skyTerm = skylightProfile(sdr);
          // Fade the rolling swell + micro grain out across the rim so the carved
          // collar reads as a clean recessed mouth, not a noise-corrugated dip.
          skyWall = THREE.MathUtils.smoothstep(sdr, SKYLIGHT_MOUTH_RADIUS, SKYLIGHT_RIM_RADIUS);
        }
      }
      const swellTerm = crater
        ? r > CRATER_OUTER_RADIUS
          ? swell
          : 0
        : swell * (skylight ? skyWall : 1);
      pos.setZ(
        i,
        fine * (skylight ? 0.4 + 0.6 * skyWall : 1) +
          swellTerm +
          micro * (skylight ? 0.3 + 0.7 * skyWall : 1) +
          (crater ? craterProfile(r) : 0) +
          skyTerm,
      );
    }
    g.computeVertexNormals();
    // aoMap reads from uv2; PlaneGeometry's uv works directly as the second set.
    if (g.attributes.uv && !g.attributes.uv2) g.setAttribute("uv2", g.attributes.uv);
    return g;
  }, [crater, skylight]);
  useEffect(() => () => geom.dispose(), [geom]);

  useEffect(() => {
    let disposed = false;
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const m of REGOLITH_MAPS) {
      // Shared URL-keyed cache (textureCache): preload and the renderer share ONE
      // decoded texture so the descent shows no pop-in. The cache owns the texture
      // (we never dispose it). Per-URL config (colorSpace/wrap/repeat/anisotropy) is
      // applied here — regolith has a single consumer, so this is safe & idempotent.
      const t = loadTexture(m.url);
      t.colorSpace = m.colorSpace;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(REGOLITH_REPEAT, REGOLITH_REPEAT);
      t.anisotropy = maxAniso;
      // Settle once the (possibly already-warm) load completes, then attach + paint.
      // If it failed, the texture stays empty and the flat fallback colour holds.
      void preloadTexture(m.url).then(() => {
        if (disposed || !matRef.current) return;
        if (!t.image) return; // failed load ⇒ keep the flat fallback (ADR-0004)
        matRef.current[m.key] = t;
        matRef.current.needsUpdate = true;
        invalidate(); // wake the demand loop so the texture shows
      });
    }
    return () => {
      // The cache owns the textures (shared, session-lived) — do NOT dispose here.
      disposed = true;
    };
  }, [gl, invalidate]);

  return (
    // receiveShadow (#104): the regolith ground catches the sun shadows cast by
    // the rovers and domes. It never casts (it's the floor), so castShadow is off.
    <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} receiveShadow>
      <primitive object={geom} attach="geometry" />
      {/* Per-site tint (Epic 04 P2): multiplies the regolith map once loaded (and
          is the flat fallback colour before/if it fails) — lunar reads warm grey,
          Shackleton darker/cooler. */}
      <meshStandardMaterial
        ref={matRef}
        color={terrainTint}
        roughness={1}
        metalness={0}
        onBeforeCompile={applyRegolithMacro}
      />
    </mesh>
  );
}

// ---- Shackleton long-shadow fakes (Epic 04 P4) -----------------------------
// At the lunar south pole the sun grazes the horizon, so structures throw very long
// shadows. We FAKE them (real shadow maps on a grazing pole sun balloon the shadow-
// camera frustum + fight the EffectComposer + the dpr≤1.5 budget — see the plan's P2
// "Shadows" note) with static, snapshot-INDEPENDENT decals: soft dark elongated
// blobs laid flat on the regolith, stretched + rotated to point AWAY from the sun.
//
// The decal texture is a PROCEDURAL canvas radial gradient (NO image asset, so no
// lib/assets.ts manifest entry is needed and nothing can pop in on descent — the
// hard ASSETS RULE). One texture is shared by all blobs; each blob is a flat plane
// scaled long in the shadow direction. Anchored under the Shackleton set-pieces.
//
// Shadow heading is derived from SITE_FRAMES.shackleton.sunDir so it can never drift
// from the actual key light: shadows fall along the GROUND projection of −sunDir.

// Anchor points (scene units, on the y=0 plane) under the Shackleton structures +
// the worksite cluster, each with a relative length multiplier for visual variety.
const SHACKLETON_SHADOW_ANCHORS: { at: [number, number]; len: number }[] = [
  { at: [-10, -16], len: 1.25 }, // shk-base-station
  { at: [14, -18], len: 1.15 }, // shk-lander
  { at: [-26, -30], len: 1.4 }, // shk-crawler
  { at: [0, 0], len: 1.0 }, // dome cluster centre
];

// Build the soft radial-gradient shadow blob once (procedural CanvasTexture — no
// manifest asset). Dark, soft-edged, transparent at the rim so it never reads as a
// hard disc on the regolith. Returns null in non-DOM (SSR/test) so callers fall back.
function makeShadowBlobTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.55, "rgba(0,0,0,0.32)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ShackletonShadows() {
  // The shadow falls OPPOSITE the sun: project −sunDir onto the ground (x,z) plane.
  // (sunDir is [x,y,z] in scene space; the ground heading ignores y.)
  const { heading, blobLen } = useMemo(() => {
    const [sx, , sz] = SITE_FRAMES.shackleton.sunDir;
    // Shadow direction on the ground = away from the sun's horizontal heading.
    const shadowAngle = Math.atan2(-sz, -sx); // around +y
    // A long base blob length; the grazing pole sun → very long shadows.
    return { heading: shadowAngle, blobLen: 18 };
  }, []);

  const tex = useMemo(makeShadowBlobTexture, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  if (!tex) return null;

  return (
    <group>
      {SHACKLETON_SHADOW_ANCHORS.map((a, i) => {
        const len = blobLen * a.len;
        const width = 5 * a.len;
        // The plane lies flat (rotateX −90°) then yaws to the shadow heading; it is
        // stretched LONG along its local x (the shadow's length) so it reads as a
        // raking streak. Offset the blob centre out along the heading so the streak
        // begins at the structure's foot and trails away from the sun.
        const ox = a.at[0] + Math.cos(heading) * len * 0.45;
        const oz = a.at[1] + Math.sin(heading) * len * 0.45;
        return (
          <mesh
            key={i}
            position={[ox, 0.03, oz]}
            rotation={[-Math.PI / 2, 0, -heading]}
            scale={[len, width, 1]}
            raycast={() => null}
            renderOrder={1}
          >
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial
              map={tex}
              transparent
              opacity={0.85}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

// ---- cinematic post-processing stack (issue #99) ---------------------------

// A single static EffectComposer carrying the full cinematic stack. It replaces
// the old halo-only SelectiveBloom pipeline. Every pass is STATIC — none runs a
// useFrame and none invalidates — so the composer renders ONLY on invalidated
// frames and 0 idle fps is preserved (frameloop="demand"). All bloom is still
// layer-gated (HALO + CELESTIAL), never full-scene — ADR-0004's hard guard.
//
// Pass order (composer applies them in declaration order):
//   1. SMAA          — antialiasing FIRST, since the canvas runs antialias:false
//                      (the composer owns the framebuffers, so MSAA on the canvas
//                      backbuffer would be wasted and trips the ANGLE/macOS
//                      glBlitFramebuffer depth/stencil error).
//   2. SelectiveBloom (halos)     — tight, small kernel, just the status halos.
//                      Its intensity is spiked above base during a bid-war (#107).
//   3. SelectiveBloom (celestial) — Sun core + Earth limb, lower threshold,
//                      wider kernel, SCREEN blend + smoothed luminance.
//   4. DepthOfField  — surface-only (mounted only on the surface): the distant
//                      Earth/horizon fall soft while the worksite stays sharp. In
//                      orbit it is OFF so the Moon hero stays deep-focus/crisp.
//   5. ChromaticAberration — orbit-only (mounted only in orbit): a subtle lens
//                      fringe on the deep-space vista; off on the surface so the
//                      worksite UI/telemetry stays clean.
//   6. Vignette      — gentle corner darkening, both views.
//   7. Noise         — faint film grain, SCREEN blend, very low opacity.
//
// MEMOIZED on its (stable) props. Without this, the parent SceneContents
// re-renders on every snapshot (~12 Hz), which re-renders the effects, whose
// internal effect-useMemos depend on a fresh `...props` object each render — so
// brand-new effects (and Selections) were being constructed ~12×/sec. Each
// Selection pulls from postprocessing's MODULE-GLOBAL layer-id counter; once it
// climbed past 31 the lib spammed "Layer out of range, resetting to 2" forever.
// memo() keeps the whole postprocessing subtree stable across snapshots, so the
// effects are built once. onSurface DOES change (a real remount on view flip),
// which is the only time the stack legitimately rebuilds.
//
// Base selective-bloom intensity (the calm-scene value). The bid-war strobe (#107)
// briefly spikes ABOVE this during auction contention, then eases back to it.
const BLOOM_BASE_INTENSITY = 2.2;
const BLOOM_WAR_SPIKE = 2.6; // added at full contention

// GodRays perf (#110): the effect is a multi-pass GPU cost that runs EVERY frame
// while mounted (orbit), even when the Sun is off-screen — which is the DEFAULT
// Wave-4 orbit pose (decoupled dark-crescent hero). So we frustum-cull it: when
// the Sun's projected position leaves the frame (+ a margin so edge rays still
// show), we shrink the god-rays render target to a tiny buffer (≈free) instead of
// half-res; we restore half-res only when the Sun is on/near screen. Setting
// `resolution.scale` resizes the target WITHOUT a shader recompile, so there is no
// hitch — and the common "Sun off-frame" orbit view pays almost nothing. Quality
// is untouched when the rays are actually visible (rays are low-frequency, so the
// 0.5 half-res + 60 samples reads identically to the old full-spec).
const GODRAYS_SAMPLES = 60; // postprocessing's own default (was an over-specced 80)
const GODRAYS_ACTIVE_SCALE = 0.5; // half-res when the Sun is on screen (lib default)
const GODRAYS_IDLE_SCALE = 0.05; // tiny buffer when the Sun is off-screen (≈free)
const GODRAYS_NDC_MARGIN = 0.4; // treat "just off-frame" as visible so edge rays show

const CinematicFX = memo(function CinematicFX({
  lightRef,
  sunRef,
  onSurface,
  beats,
}: {
  lightRef: React.RefObject<THREE.DirectionalLight>;
  // The Sun core disc, used as the GodRays light source (#110). May be null until
  // SkyBodies mounts; the GodRays pass is skipped until it resolves.
  sunRef: React.RefObject<THREE.Mesh>;
  onSurface: boolean;
  beats: React.RefObject<ActiveBeat[]>;
}) {
  // The directional light mounts in the same pass as this component, so its ref
  // is null on first render. Force exactly one re-render after mount so the ref
  // has resolved; SelectiveBloom requires a non-null light, so we render nothing
  // until then.
  const [, ready] = useState(0);
  useEffect(() => ready(1), []);
  const bloomRef = useRef<SelectiveBloomEffect>(null);
  const camera = useThree((s) => s.camera);

  // GodRays frustum-cull bookkeeping (#110 perf). `godRaysVisible` tracks the last
  // applied on/off-screen state so we only resize the render target on a TRANSITION
  // (never per-frame), and `sunNdc` is a reused scratch vector (no per-frame alloc).
  const godRaysRef = useRef<GodRaysEffect>(null);
  const godRaysVisible = useRef<boolean | null>(null);
  const sunNdc = useRef(new THREE.Vector3());
  useFrame(() => {
    const fx = godRaysRef.current;
    const sunMesh = sunRef.current;
    if (!fx || !sunMesh) return; // not mounted (surface) or Sun not resolved yet
    sunMesh.getWorldPosition(sunNdc.current).project(camera);
    const v = sunNdc.current;
    const onScreen =
      v.z < 1 &&
      Math.abs(v.x) <= 1 + GODRAYS_NDC_MARGIN &&
      Math.abs(v.y) <= 1 + GODRAYS_NDC_MARGIN;
    if (godRaysVisible.current === onScreen) return; // only act on a transition
    godRaysVisible.current = onScreen;
    fx.resolution.scale = onScreen ? GODRAYS_ACTIVE_SCALE : GODRAYS_IDLE_SCALE;
  });

  // Bid-war bloom spike (#107): while multiple rovers contend, pump the bloom
  // intensity above its base in proportion to the strobe, easing back to base as
  // the contention clears. A pure read of the live beats (no random), and it only
  // ever runs on already-invalidated frames (the bid beats keep the loop alive),
  // so it adds no idle work — when no bids are live it settles to base and stops.
  const spiked = useRef(false);
  useFrame(() => {
    const effect = bloomRef.current;
    const list = beats.current;
    if (!effect) return;
    let strobe = 0;
    if (list && list.length > 0) {
      strobe = bidWarStrobe(activeBidders(list, performance.now()));
    }
    if (strobe <= 0) {
      if (!spiked.current) return; // already at base — nothing to reset
      spiked.current = false;
      effect.intensity = BLOOM_BASE_INTENSITY; // settle back exactly once
      return;
    }
    spiked.current = true;
    effect.intensity = BLOOM_BASE_INTENSITY + BLOOM_WAR_SPIKE * strobe;
  });

  const light = lightRef.current;
  if (!light) return null;
  // Resolved by the post-mount re-render above (SkyBodies mounts in the same
  // commit). null-safe: GodRays is simply skipped until the Sun core exists.
  const sun = sunRef.current;
  return (
    // multisampling={0}: SMAA does the antialiasing inside the composer, so
    // composer MSAA buys nothing and would only cost a multisampled target.
    <EffectComposer multisampling={0}>
      {/* SMAA first — the canvas runs antialias:false (composer owns framebuffers). */}
      <SMAA />
      {/* Halo bloom — status/winner halos only. Tight: small kernel, high-ish
          threshold so only the bright halo cores glow. SCREEN blend, smoothed. */}
      <SelectiveBloom
        ref={bloomRef}
        lights={[light]}
        selectionLayer={HALO_BLOOM_LAYER}
        blendFunction={BlendFunction.SCREEN}
        intensity={BLOOM_BASE_INTENSITY}
        luminanceThreshold={0.1}
        luminanceSmoothing={0.2}
        mipmapBlur
        kernelSize={KernelSize.SMALL}
        radius={0.6}
      />
      {/* Celestial bloom — the genuinely bright bodies (Sun core, Earth limb) on
          CELESTIAL_BLOOM_LAYER. Lower threshold + wider kernel so they glow softly;
          SCREEN blend with smoothed luminance for a clean, additive halo. */}
      <SelectiveBloom
        lights={[light]}
        selectionLayer={CELESTIAL_BLOOM_LAYER}
        blendFunction={BlendFunction.SCREEN}
        intensity={1.1}
        luminanceThreshold={0.08}
        luminanceSmoothing={0.35}
        mipmapBlur
        kernelSize={KernelSize.LARGE}
        radius={0.85}
      />
      {/* Sun GodRays (#110) — volumetric light shafts radiating from the Sun core,
          AFTER bloom in the stack. Orbit-gated (the Sun is the orbit hero) and a
          graceful no-op when the Sun ref hasn't resolved. The Wave-4 orbit hero is
          the dark-side crescent Moon, so the decoupled Sun sits off-frame in the
          default pose — the shafts reveal as the user orbits around toward it; the
          Moon's depth occludes them for a true volumetric shadow. Static pass. */}
      {!onSurface && sun ? (
        <GodRays
          ref={godRaysRef}
          sun={sun}
          blendFunction={BlendFunction.SCREEN}
          samples={GODRAYS_SAMPLES}
          resolutionScale={GODRAYS_ACTIVE_SCALE}
          density={0.5}
          decay={0.93}
          weight={0.3}
          exposure={0.3}
          clampMax={1}
          kernelSize={KernelSize.SMALL}
          blur
        />
      ) : (
        <></>
      )}
      {/* Surface-gated DoF — distant Earth/horizon soften while the worksite stays
          sharp. Mounted ONLY on the surface; in orbit the Moon hero stays crisp. */}
      {onSurface ? (
        <DepthOfField
          focusDistance={0.0}
          focalLength={0.02}
          bokehScale={1.6}
          height={480}
        />
      ) : (
        <></>
      )}
      {/* Orbit-only chromatic aberration — a subtle lens fringe on the deep-space
          vista. Off on the surface so worksite telemetry stays crisp. */}
      {onSurface ? (
        <></>
      ) : (
        <ChromaticAberration
          blendFunction={BlendFunction.NORMAL}
          offset={CHROMATIC_OFFSET}
          radialModulation={false}
          modulationOffset={0}
        />
      )}
      {/* Gentle corner vignette — both views. */}
      <Vignette offset={0.3} darkness={0.4} blendFunction={BlendFunction.NORMAL} />
      {/* Faint film grain — SCREEN blend, very low opacity, both views. */}
      <Noise blendFunction={BlendFunction.SCREEN} opacity={0.018} />
    </EffectComposer>
  );
});

// View-mode (issue #49). "surface" is the DEFAULT clamped worksite framing
// (ADR-0004 fixed default orbit angle); "orbit" is a DISTINCT clamped preset
// that pulls the camera back to take in a distant parked Moon. Each mode keeps
// its own clamps/target so neither can be knocked into a useless pose.
export type ViewMode = "surface" | "orbit";

// The active worksite shown on the surface (Epic 04 P2). The surface renders ONE
// site at a time; the operator toggles between them. Snapshot rovers/tasks are
// sliced by this (back-compat: an untagged rover/task ⇒ "lunar"). Keep in lockstep
// with lib/scene's SITE_FRAMES keys.
export type SiteId = "lunar" | "shackleton";

type Scene3DProps = {
  snapshot: Snapshot | null;
  selected: string | null;
  onPick: (id: string | null) => void;
  // Drag-to-place (bh-05). `placing` arms the ground placement plane; `ghost` is
  // the transient preview (null until the cursor hits the ground); `onPlaceMove`
  // reports the world origin under the cursor; `onPlaceConfirm` drops it. All are
  // optional so the 2D fallback / tests can omit them.
  placing?: boolean;
  ghost?: Ghost | null;
  onPlaceMove?: (origin: Vec2) => void;
  onPlaceConfirm?: () => void;
  // In-scene placement gestures (Epic 06 P1, #151). `placementRotation` is the
  // current rotation (radians) the right-drag uses as its base; `onPlaceRotate`
  // pushes the new absolute rotation; `onPlaceCancel` aborts (ESC / interrupt).
  // `placementInvalidReason` is the client validity (null = valid) surfaced as a
  // cursor-anchored ✓/✗ tick. All optional (tests / 2D fallback omit them).
  placementRotation?: number;
  placementInvalidReason?: string | null;
  onPlaceRotate?: (rotation: number) => void;
  onPlaceCancel?: () => void;
  // View-mode framing (issue #49). Defaults to "surface" so the scene keeps its
  // rehearsed worksite pose when the prop is omitted (tests / 2D fallback).
  viewMode?: ViewMode;
  // Lets the in-scene lunar-base marker (orbit view) request a view change —
  // clicking the marker calls this with "surface", flipping the app to surface
  // view and triggering the descent. Optional (tests / 2D fallback omit it).
  onViewModeChange?: (mode: ViewMode) => void;
  // The active surface site (Epic 04 P2). Defaults to "lunar" when omitted so the
  // single-site path / tests keep working. SceneContents slices the snapshot to
  // this site and reads its per-site framing/lighting/tint/fog/pieces.
  activeSite?: SiteId;
  // Lets an in-scene orbit site marker (Epic 04 P3) request the active site. A
  // marker click calls BOTH this and onViewModeChange("surface"), descending to
  // the clicked site. Optional (tests / single-site path omit it).
  onActiveSiteChange?: (site: SiteId) => void;
  // Cinematic marker cues (Epic 07 S4 · #157), threaded straight through to
  // SkyBodies' orbit site markers. Both optional + additive Scenery (gated upstream
  // on the `cinematic` arm flag), so omitting them leaves the markers unchanged:
  //   · `lockedSite` forces the lock-on look on that marker without a mouse hover.
  //   · `statusOverride` flips the Shackleton marker to cyan/"operational" (Beat 15).
  lockedSite?: SiteId;
  statusOverride?: boolean;
  // Orbit-open camera-arc cue (Epic 07 S5 · #158, Beats 1–2). While true the
  // <CinematicOpen> rig (mounted alongside CameraFeel) drifts the camera along the
  // dark lunar limb then ARCS it so the *fixed* sun's godrays/bloom crest in,
  // easing into ORBIT_POSE — "lost in the dark, found by the sun". Additive Scenery
  // gated upstream on the `cinematic` arm flag (it invents ZERO snapshot/wire
  // fields). Omitted/false ⇒ the orbit behaves exactly as today (the script-
  // sanctioned cold-hold fallback): the rig NEVER blocks anything. Only meaningful
  // in orbit view; the rig itself no-ops on the surface.
  cinematicOpen?: boolean;
  // One-shot disarm: the orbit-open is a fire-once intro beat, so the rig calls
  // this when its arc finishes OR is interrupted, and App flips `cinematicOpen`
  // back to false. Without it the flag stays latched and `active` re-fires the arc
  // every time the view returns to orbit (e.g. the ascent bookend) — the arc then
  // captures a mid-ascent pose and fights the ascent driver (flicker + a camera
  // stuck close on the Moon). Must be a STABLE callback (it's an effect dep).
  onCinematicOpenDone?: () => void;
};

// Per-mode OrbitControls clamps + target. Both presets are clamped (ADR-0004):
// surface is the rehearsed worksite framing; orbit pulls back far enough to see
// a distant Moon WITHOUT just widening surface-mode's reach (kept distinct). The
// far plane (~8000) puts a parked Moon in-frustum; maxDistance here stays well
// under that so the orbit target is always renderable.
const VIEW_PRESETS: Record<
  ViewMode,
  {
    minDistance: number;
    maxDistance: number;
    minPolarAngle: number;
    maxPolarAngle: number;
    target: [number, number, number];
  }
> = {
  surface: {
    // A 3D-game / RTS-style camera looking DOWN on the worksite so the regolith
    // terrain reads as a surveyable plain (not a horizon strip). The band is wide
    // enough to pull back and take in the whole site; the polar clamps favour an
    // elevated 3/4 look — near top-down at the tight end (~18° off vertical), with
    // room to tip toward the horizon (~80°) if the player wants the standing-on-
    // the-Moon read. Target sits on the worksite cluster centre. Tune on screen.
    minDistance: 6,
    // Pulled out from 34 to give the SHACKLETON crater pose (dist ≈ 33.5 from the
    // floor target) clamp headroom — at 34 idle drift could trip the OrbitControls
    // distance clamp and yank the camera in. Lunar's default framing (dist ≈ 20) is
    // unchanged; it just gains a little zoom-out room. Still far under the far-plane.
    maxDistance: 60,
    minPolarAngle: Math.PI / 10,
    maxPolarAngle: Math.PI / 2.25,
    target: [2.5, 0, -3],
  },
  orbit: {
    // The space vista: the camera ORBITS THE MOON GLOBE itself (target = the
    // globe's berth, imported from SkyBodies so the two can never drift apart).
    // The worksite is hidden in this mode (it's "on" the Moon), so there is no
    // floating diorama in frame — just the Moon, distant Earth, and stars. The
    // distance band keeps a radius-90 globe filling a good part of the 50° fov.
    minDistance: 220,
    maxDistance: 640,
    minPolarAngle: Math.PI / 4,
    maxPolarAngle: Math.PI / 2.2,
    target: [MOON_POSITION[0], MOON_POSITION[1], MOON_POSITION[2]],
  },
};

// ---- view-transition poses + easing (glare-masked descent) ------------------
// Each mode has a canonical camera pose the transition flies BETWEEN. The toggle
// plays a two-beat, glare-masked move: fly toward the Moon (or lift off the
// surface) into a white sunlit flash that hides the scene swap, then settle into
// the destination pose. Tuned by eye; see CameraTransition.
type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

// Surface: an elevated 3D-game / RTS camera looking DOWN on the worksite (matches
// the Canvas `camera` default). High vantage at a ~43° pitch off vertical so the
// regolith terrain spreads out below as a surveyable plain — the rovers + rising
// dome read from above, with the literally-sized launch complex laid out behind.
const SURFACE_POSE: Pose = {
  position: new THREE.Vector3(2, 9, 9),
  target: new THREE.Vector3(0, 0.8, -2),
};
// Per-site surface poses. Lunar reuses the elevated worksite framing above.
// Shackleton now frames its CARVED CRATER: the camera is seated up on the near rim
// (high + well back on +z, above the crest height ≈ CRATER_RIM_HEIGHT) looking DOWN
// and IN onto the shadowed floor where the outpost sits, so the bowl + its sunlit
// rim read as a distinct place (the SVS-4716 pole-crater look). This is the same
// pose the orbit→descend-to-Shackleton lands on (poseFor), so the descent also
// crests the rim. Tuned so the settled polar angle stays inside the surface
// OrbitControls clamp [π/10, π/2.25] (≈70° here).
const LUNAR_SURFACE_POSE: Pose = SURFACE_POSE;
const SHACKLETON_SURFACE_POSE: Pose = {
  position: new THREE.Vector3(2.5, 13, 19),
  target: new THREE.Vector3(2.5, 1, -3),
};
// A high vantage straight over the worksite — the start/end of the descent half,
// so the surface "drops in" from above rather than cutting in flat.
const SURFACE_HIGH_POSE: Pose = {
  position: new THREE.Vector3(0, 120, 80),
  target: new THREE.Vector3(0, 0.6, 0),
};
// Orbit: the camera berthed off the Moon globe, framing it as the hero. The
// offset is set so the camera→Moon line is ~72° OFF the Moon→Sun line (#81): the
// sun rakes ACROSS the globe (3/4 side-light) instead of from behind it, so the
// orbit preset frames a visible soft side-lit terminator — the single biggest
// realism win. |offset| ≈ 280 (pulled in from 418 so the Moon fills the frame as
// a hero — subtends ~37° vs ~25°), kept on the SAME approach axis so the ~72°
// terminator is preserved; inside the orbit distance band (220–640) at a ~72°
// polar angle (inside the preset's [45°, 81.8°] clamps). Target = globe center.
// Do NOT change SUN_POSITION/MOON_POSITION (lib/scene.ts) — only the pose.
const ORBIT_POSE: Pose = {
  position: new THREE.Vector3(
    MOON_POSITION[0] + 264,
    MOON_POSITION[1] + 85,
    MOON_POSITION[2] + 26,
  ),
  target: new THREE.Vector3(...MOON_POSITION),
};
// The closest point of the fly-to-Moon beat: the globe looms large just as the
// glare peaks and the scene swaps. Sits on the SAME side-lit approach axis as
// ORBIT_POSE (|offset| ≈ 175) so the terminator stays visible as we close in.
const MOON_CLOSE_POSE: Pose = {
  position: new THREE.Vector3(
    MOON_POSITION[0] + 166,
    MOON_POSITION[1] + 54,
    MOON_POSITION[2] + 16,
  ),
  target: new THREE.Vector3(...MOON_POSITION),
};

const TRANSITION_MS = 1500;
// The cinematic intro fly-in (#108) reuses the descent rig but stretched, so the
// experience opens as a slow deep-space arrival rather than a snappy mode toggle.
const INTRO_MS = 4500;
// Surface→surface site swap: a cinematic GROUND DRIVE — NOT a fly-to-Moon and NOT a
// lateral cut. The camera dives near the surface, races out across the open regolith
// (SKIM_OUT_DIST units, at SKIM_ALTITUDE) toward the horizon, flips the rendered site
// under a dust-brownout peak, then races back in and settles on the destination
// surface pose (for Shackleton, cresting the rim into the crater). Long enough to
// read as a journey, not a cut.
const TRAVERSE_MS = 2900;
const SKIM_ALTITUDE = 4; // scene-y of the low ground-skim race
const SKIM_OUT_DIST = 120; // how far out across the plain the drive races

// ---- ground-traverse envelope (cinematic site drive) -----------------------
// The surface→surface site swap is a cinematic GROUND DRIVE (not a lateral whip):
// the camera dives low, races across the open regolith, and the destination site is
// swapped behind a warm REGOLITH-DUST brownout at the far point. This envelope, as a
// function of progress t∈[0,1], returns the dust-veil opacity, the eased path
// parameter `k` for lerpPose, and whether the content swap has passed (t≥0.5). Kept
// a pure helper so the shape is unit-testable. The veil is WIDER + flatter-topped
// than the old glare spike — the drive is ~3s, so the one swap frame must be FULLY
// covered (peak ≈ 1 with a plateau), not just a brief flash.
export function traverseEnvelope(t: number) {
  const c = Math.min(1, Math.max(0, t));
  // Dust brownout: a flat-topped peak around the t=0.5 swap. DUST_HALF widens the
  // window and the gentle power keeps it near-opaque across the peak so the swap is
  // never glimpsed; it still falls to 0 at both ends so the regolith reads clean
  // before and after the drive.
  const DUST_HALF = 0.3;
  const veil = Math.pow(Math.max(0, 1 - Math.abs(c - 0.5) / DUST_HALF), 1.25);
  // Path easing: ease-in-out so the drive accelerates out of the old framing and
  // decelerates HARD into the new one (settles cleanly, no overshoot).
  const k = c * c * (3 - 2 * c);
  return { veil, k, swapped: c >= 0.5 };
}

// ---- Earthrise hero pose (#108) --------------------------------------------
// The `earthrise-hero` beat lerps the SURFACE camera from its current pose to a
// framing that holds Earth over the lunar horizon: aim down the azimuth TOWARD
// Earth (so Earth's disc sits in frame above the regolith line), at a low pitch
// so a band of horizon reads beneath it. Derived from EARTH_POSITION so the aim
// can never drift from the rendered Earth. Camera backs off slightly along the
// opposite (away-from-Earth) heading and lifts a touch for a hero vantage.
const EARTHRISE_HERO_POSE: Pose = (() => {
  // Horizontal heading from the worksite toward Earth (ignore Earth's depth/Y).
  const dir = new THREE.Vector2(EARTH_POSITION[0], EARTH_POSITION[2]).normalize();
  // Look at a far point on that heading, raised so Earth's disc frames ABOVE the
  // horizon (Earth is far + slightly below the plane, but its apparent disc rides
  // the limb when aimed up the heading) — a touch of lift keeps the horizon in shot.
  const target = new THREE.Vector3(dir.x * 60, 9, dir.y * 60);
  // Camera sits behind the worksite, opposite Earth's heading, at surface height
  // so the regolith plain leads the eye out to the Earthrise.
  const position = new THREE.Vector3(-dir.x * 22, 8, -dir.y * 22);
  return { position, target };
})();

// ---- descent easing (#84, SVS 4444) ----------------------------------------
// The descent is choreographed with ASYMMETRIC easing instead of the old
// symmetric easeInOutCubic: a gentle ease-in departure, a fast featureless
// middle, and a HARD ease-out into the landing so the arrival settles gently
// (not a fall). We split that across the two half-beats:
//   beat 1 (depart → glare peak): easeInQuad  — slow start, accelerating away.
//   beat 2 (glare peak → arrive): easeOutQuint — fast in, decelerating hard.
const easeInQuad = (x: number) => x * x;
const easeOutQuint = (x: number) => 1 - Math.pow(1 - x, 5);
// Kept as a baseline (smoothstep) for the pitch/arc shaping sub-curves.
const smooth = (x: number) => x * x * (3 - 2 * x);

// lerpPose positions the camera and its look target between two poses. The look
// target carries a PITCH RAMP (#84): the camera holds a near-nadir aim for most
// of the move and pitches up to the oblique destination only in the final ~15%,
// so the horizon rises into frame at the very end (the "flat map → real place"
// reveal). `pitchHold` is the fraction [0,1] of this beat spent at the nadir aim
// before the pitch-up; pass 1 to disable the ramp (plain lerp) for beat 1.
const lerpPose = (
  a: Pose,
  b: Pose,
  k: number,
  outPos: THREE.Vector3,
  outTgt: THREE.Vector3,
  pitchHold = 1,
) => {
  outPos.lerpVectors(a.position, b.position, k);
  // Target ramp: stay near A's aim until `pitchHold`, then ease up to B's aim
  // over the remaining tail — the horizon-rise window.
  const tk =
    pitchHold >= 1
      ? k
      : k <= pitchHold
        ? 0
        : smooth((k - pitchHold) / (1 - pitchHold));
  outTgt.lerpVectors(a.target, b.target, tk);
};

// GHOST_OK / GHOST_BAD tint the placement preview green when the spot is valid,
// red when the client-side gate (bounds/no-overlap) rejects it — the UI feedback
// for "invalid placement is rejected" before the control is even emitted.
const GHOST_OK = "#38e1ff";
const GHOST_BAD = "#e74c3c";

// ---- drag-to-place ghost + placement plane (bh-05) -------------------------

// BlueprintGhost draws the transient placement preview: each ghost Task's Build
// envelope as a flat footprint quad on the ground, plus a thin upright box hinting
// the envelope height. Tinted green when valid, red when the client gate rejects
// the spot. It is CLIENT-ONLY transient state (never from the snapshot), so the
// scene stays a pure function of the snapshot for everything authoritative — the
// placed tasks themselves arrive via the next snapshot (ADR-0004).
function BlueprintGhost({ ghost, map }: { ghost: Ghost; map: SceneMap }) {
  const color = ghost.invalid ? GHOST_BAD : GHOST_OK;
  return (
    <group>
      {ghost.tasks.map((t) => {
        const f = footprintOf(t);
        const center = map.at({ X: f.cx, Y: f.cy }, 0.06);
        const w = f.halfX * 2 * map.scale;
        const d = f.halfY * 2 * map.scale;
        const h = Math.max(0.05, (t.envelope.size.Z * map.scale) / 2);
        return (
          <group key={t.id} position={[center.x, 0, center.z]}>
            {/* Footprint quad flat on the ground. */}
            <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
              <planeGeometry args={[w, d]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.35}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            {/* A faint envelope box, so the ghost reads as a volume not just a pad. */}
            <mesh position={[0, h, 0]} raycast={() => null}>
              <boxGeometry args={[w, h * 2, d]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={0.12}
                depthWrite={false}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// PlacementTip is the cursor-anchored validity tick (Epic 06 P1, #151) that
// replaces the old BlueprintPalette sub-panel's validity line. It billboards a
// tiny ✓ (valid) / ✗ + reason (invalid) overlay at the ghost centroid, so the
// operator reads placement validity right where they're aiming. drei <Html> with
// `center` keeps it pinned to the spot; `pointerEvents: none` so it never eats the
// placement gestures. Purely transient client UI (ADR-0004) — never the snapshot.
function PlacementTip({
  ghost,
  map,
  invalidReason,
}: {
  ghost: Ghost;
  map: SceneMap;
  invalidReason: string | null;
}) {
  if (ghost.tasks.length === 0) return null;
  // Anchor at the centroid of the ghost task positions (the placement origin region).
  let cx = 0;
  let cy = 0;
  for (const t of ghost.tasks) {
    cx += t.pos.X;
    cy += t.pos.Y;
  }
  cx /= ghost.tasks.length;
  cy /= ghost.tasks.length;
  const center = map.at({ X: cx, Y: cy }, 0.06);
  const valid = invalidReason === null;
  return (
    <Html
      position={[center.x, center.y + 1.2, center.z]}
      center
      zIndexRange={[20, 0]}
      style={{ pointerEvents: "none" }}
    >
      <div className={`place-tip ${valid ? "place-tip--ok" : "place-tip--bad"}`}>
        <span className="place-tip__mark">{valid ? "✓" : "✗"}</span>
        {valid ? null : <span className="place-tip__reason">{invalidReason}</span>}
      </div>
    </Html>
  );
}

// PlacementPlane is a large invisible ground plane, mounted ONLY while placing,
// that captures the cursor and the placement gestures (Epic 06 P1, #151):
//   - pointer-move raycasts a world origin (via the shared sceneMap inverse, so the
//     ghost can't drift from the rendered world) and reports it via onMove;
//   - LEFT-click (button 0) on a spot confirms the drop (onConfirm) — gated to the
//     left button so a right-drag never places;
//   - RIGHT-drag (button 2) rotates the ghost: the horizontal pixel delta from the
//     drag start maps to a rotation delta (dragDeltaToRadians) added to the base
//     rotation captured at press, pushed via onRotate. Pointer capture on the canvas
//     keeps the drag tracking even when the cursor leaves the plane.
// It sits just above the terrain so it wins the raycast over scene geometry while
// placing. Camera pan/orbit is locked by Scene3D (controls.enableRotate=false +
// enablePan=false); scroll-zoom stays live. The browser context menu is suppressed
// by Scene3D's placing-scoped contextmenu listener.
function PlacementPlane({
  map,
  rotation,
  onMove,
  onConfirm,
  onRotate,
}: {
  map: SceneMap;
  rotation: number;
  onMove: (origin: Vec2) => void;
  onConfirm: () => void;
  onRotate: (rotation: number) => void;
}) {
  // Right-drag-rotate transient state — refs (not state) so a frequent drag never
  // re-renders the tree. `baseRotation` is the rotation at press; `startX` the
  // pointer x at press; `pointerId` the captured pointer (null when not rotating).
  const drag = useRef<{ baseRotation: number; startX: number; pointerId: number } | null>(null);
  return (
    <mesh
      position={[0, 0.02, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        // While a right-drag is active, map the horizontal pixel delta to rotation;
        // otherwise track the cursor origin for the ghost.
        if (drag.current) {
          const dx = e.nativeEvent.clientX - drag.current.startX;
          onRotate(drag.current.baseRotation + dragDeltaToRadians(dx));
          return;
        }
        // e.point is the world-space (scene) hit; map its ground x/z back to the
        // worksite origin via the inverse of the shared world→scene projection.
        onMove(map.invert(e.point.x, e.point.z));
      }}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.button === 2) {
          // Right button → start a rotate-drag. Capture the pointer on the canvas so
          // the rotation keeps tracking even if the cursor leaves this plane.
          const target = e.nativeEvent.target as HTMLElement | null;
          target?.setPointerCapture?.(e.pointerId);
          drag.current = {
            baseRotation: rotation,
            startX: e.nativeEvent.clientX,
            pointerId: e.pointerId,
          };
          return;
        }
        if (e.button === 0) {
          // Left button → confirm the drop. Any other button is ignored (so a
          // middle-click or stray button never places).
          onConfirm();
        }
      }}
      onPointerUp={(e: ThreeEvent<PointerEvent>) => {
        if (drag.current && e.button === 2) {
          const target = e.nativeEvent.target as HTMLElement | null;
          target?.releasePointerCapture?.(drag.current.pointerId);
          drag.current = null;
        }
      }}
    >
      <planeGeometry args={[GROUND_SPAN * 4, GROUND_SPAN * 4]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

// Surface horizon fog is now PER-SITE (Epic 04 P2): each SiteFrame carries its own
// `fog: [color, near, far]` (see SITE_FRAMES in lib/scene), read in BOTH
// SceneContents return branches so they stay consistent. Lunar keeps the warm deep
// grey dusk (#101); Shackleton uses a tighter/darker fog for the pole. Surface-
// only; orbit skips it so the Moon globe stays crisp.

// ---- cinematic camera beats (#108) -----------------------------------------
//
// CinematicCamera drives the camera-affecting Wave-3 beats (earthrise-hero +
// launch shake) from the live beat list. It lives INSIDE the Canvas so it can
// reach the camera/OrbitControls via useThree and animate them in a useFrame.
// Like every beat it only DECORATES the snapshot — it never invents world state,
// and it returns the camera to its base pose (and re-enables controls) the moment
// the last beat clears, so the demand loop idles at 0 fps (the invariant; SceneⅭ
// ontents' own useFrame keeps the loop alive while beats are live).
//
// EARTHRISE-HERO: disables controls, lerps the camera from its current pose to
// EARTHRISE_HERO_POSE (Earth over the horizon), holds, then lerps back and
// restores controls at the pose it left — driven by earthriseEnvelope (0 at both
// ends, 1 in the hold), so the move is fully reversible with no residual offset.
//
// LAUNCH: leaves OrbitControls in charge and adds a DECAYING positional shake
// (launchShake) on top of the camera each frame — applied as a transient offset
// that is removed before the next frame's read, so it never accumulates and
// settles to exactly zero (pick/click-to-kill stay intact: the shake never
// touches controls.enabled or the raycaster).
type CinematicControls = {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
};

function CinematicCamera({ beats }: { beats: React.RefObject<ActiveBeat[]> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as CinematicControls | null;
  const invalidate = useThree((s) => s.invalidate);

  // Earthrise takeover state: the pose the camera was at when the beat began, so
  // we can lerp out and restore it exactly. Null when no earthrise beat is active.
  const heroFrom = useRef<Pose | null>(null);
  // The shake offset applied last frame, removed at the top of the next frame so
  // the shake is purely additive and never accumulates into the base pose.
  const shakeOffset = useRef(new THREE.Vector3(0, 0, 0));
  const tmpPos = useRef(new THREE.Vector3());
  const tmpTgt = useRef(new THREE.Vector3());

  useFrame(() => {
    const list = beats.current;
    // Always undo last frame's shake offset first so the base pose is clean,
    // whether or not a launch beat is still active this frame.
    if (shakeOffset.current.lengthSq() > 0) {
      camera.position.sub(shakeOffset.current);
      shakeOffset.current.set(0, 0, 0);
    }
    if (!list || list.length === 0) {
      // No beats: if we were mid-earthrise (e.g. the beat was pruned), restore.
      if (heroFrom.current) {
        if (controls) {
          controls.enabled = true;
          controls.update();
        }
        heroFrom.current = null;
        invalidate();
      }
      return;
    }

    const now = performance.now();
    let hero = 0;
    let launch = 0;
    for (const b of list) {
      if (b.kind === "earthrise-hero") hero = Math.max(hero, beatProgress(b, now));
      else if (b.kind === "launch") launch = Math.max(launch, beatProgress(b, now));
    }

    // EARTHRISE-HERO — disable controls, lerp toward the hero framing, hold, then
    // lerp back. earthriseEnvelope is 0 at both ends so we land back on `heroFrom`.
    const heroActive = hero > 0 && hero < 1;
    if (heroActive) {
      if (!heroFrom.current) {
        // Capture the pose to fly FROM (and back TO). Disable controls for the move.
        heroFrom.current = {
          position: camera.position.clone(),
          target: controls ? controls.target.clone() : new THREE.Vector3(0, 4, 0),
        };
        if (controls) controls.enabled = false;
      }
      const k = earthriseEnvelope(hero);
      tmpPos.current.lerpVectors(heroFrom.current.position, EARTHRISE_HERO_POSE.position, k);
      tmpTgt.current.lerpVectors(heroFrom.current.target, EARTHRISE_HERO_POSE.target, k);
      camera.position.copy(tmpPos.current);
      camera.up.set(0, 1, 0);
      camera.lookAt(tmpTgt.current);
      if (controls) controls.target.copy(tmpTgt.current);
    } else if (heroFrom.current) {
      // Earthrise just finished — settle exactly back on the captured pose and
      // hand the camera back to OrbitControls.
      camera.position.copy(heroFrom.current.position);
      camera.up.set(0, 1, 0);
      camera.lookAt(heroFrom.current.target);
      if (controls) {
        controls.target.copy(heroFrom.current.target);
        controls.enabled = true;
        controls.update();
      }
      heroFrom.current = null;
    }

    // LAUNCH — decaying screen shake. A small positional jitter that decays to 0;
    // applied AFTER any earthrise pose so a launch during the hold still rattles.
    if (launch > 0 && launch < 1) {
      const SHAKE = 0.5; // peak amplitude in scene units (subtle, not nauseating)
      shakeOffset.current.set(
        launchShake(launch, 0) * SHAKE,
        launchShake(launch, 1) * SHAKE,
        launchShake(launch, 2) * SHAKE * 0.5,
      );
      camera.position.add(shakeOffset.current);
    }

    invalidate();
  });

  return null;
}

// LaunchFlare draws the launch beat's additive exhaust + godray flare: a stack of
// emissive, non-tone-mapped billboards at the launch pad that bloom up and fade
// over the beat. Always mounted but hidden; visibility/scale/opacity are driven
// in useFrame so it costs nothing between beats (mirrors the winner/recovery
// rings). On the bloom layer so the flare glows. Snapshot-INDEPENDENT decoration.
function LaunchFlare({ beats }: { beats: React.RefObject<ActiveBeat[]> }) {
  const groupRef = useRef<THREE.Group>(null);
  const coreMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const plumeMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Put the flare on the bloom layer so it glows like the halos.
  useEffect(() => {
    groupRef.current?.traverse((o) => o.layers.enable(HALO_BLOOM_LAYER));
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const list = beats.current;
    let launch = 0;
    if (list) {
      const now = performance.now();
      for (const b of list) {
        if (b.kind === "launch") {
          launch = Math.max(launch, beatProgress(b, now));
        }
      }
    }
    const active = launch > 0 && launch < 1;
    if (!active) {
      if (group.visible) group.visible = false;
      return;
    }
    group.visible = true;
    // Ignition flash ramps up fast then the plume climbs and fades over the beat.
    const ignite = Math.min(1, launch / 0.12); // quick flash-up in the first 12%
    const fade = 1 - launch; // overall decay toward the end
    const core = coreMatRef.current;
    const plume = plumeMatRef.current;
    if (core) core.opacity = ignite * fade;
    if (plume) plume.opacity = ignite * fade * 0.8;
    // The plume billboard stretches upward as the launch climbs.
    group.scale.set(1, 1 + launch * 2.2, 1);
  });

  // Placed at the launch-pad corner of the worksite (matches LaunchScenery's
  // edge placement). Two stacked emissive quads: a tight bright core + a taller
  // soft plume, both additive + non-tone-mapped so they read as raw light.
  return (
    <group ref={groupRef} position={[GROUND_SPAN * 0.7, 0, GROUND_SPAN * 0.7]} visible={false}>
      {/* Bright ignition core at the pad base. */}
      <mesh position={[0, 1.2, 0]} raycast={() => null}>
        <planeGeometry args={[2.2, 2.6]} />
        <meshBasicMaterial
          ref={coreMatRef}
          color="#fff3d8"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Taller soft exhaust plume climbing above the core. */}
      <mesh position={[0, 3.4, 0]} raycast={() => null}>
        <planeGeometry args={[1.6, 5.0]} />
        <meshBasicMaterial
          ref={plumeMatRef}
          color="#ffd29a"
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// The actual scene contents (inside <Canvas>). The snapshot → meshes mapping is
// a single pure pass that re-renders ONLY when a new snapshot arrives. Beats
// animate via per-mesh useFrame ref-mutation (in Rover3D/TaskBlock), so the
// React tree never re-renders per frame. This component's own useFrame just
// prunes expired beats and keeps the demand loop alive while any beat is live.
function SceneContents({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  placementRotation = 0,
  placementInvalidReason = null,
  onPlaceMove,
  onPlaceConfirm,
  onPlaceRotate,
  viewMode = "surface",
  onViewModeChange,
  activeSite = "lunar",
  onActiveSiteChange,
  lockedSite,
  statusOverride,
}: Scene3DProps) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  // Shared ref to the Sun core disc — surfaced from SkyBodies so the GodRays
  // post-FX pass (#110) can use the Sun as its light source.
  const sunRef = useRef<THREE.Mesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Clicking an orbit-view site marker (Epic 04 P3) selects that site AND flips to
  // surface view → the existing glare-masked descent lands on the clicked site.
  // This is the PRIMARY entry into the surface now that orbit is the default view.
  const onSelectSite =
    onViewModeChange && onActiveSiteChange
      ? (site: SiteId) => {
          onActiveSiteChange(site);
          onViewModeChange("surface");
        }
      : undefined;

  // Shared geometry buffers — one set per Canvas mount, disposed on unmount.
  const geo = useMemo(makeSceneGeo, []);
  useEffect(() => () => disposeSceneGeo(geo), [geo]);

  // Beat bookkeeping — DECORATION ONLY, derived from the server's own events.
  // Stamped with performance.now() so animation progress is independent of
  // snapshot cadence. Held in a ref and read by each mesh's
  // useFrame; mutating it never triggers a React re-render.
  const beats = useRef<ActiveBeat[]>([]);
  const lastAt = useRef<number>(Number.NEGATIVE_INFINITY);

  // Drag-to-place is transient client state, not a snapshot, so it does NOT ride
  // the snapshot-driven invalidate above. Wake the demand loop whenever the ghost
  // (cursor origin / rotation / validity) or the placing arm changes, so the ghost
  // redraws as the user moves the cursor. Cheap: it draws one frame per change.
  useEffect(() => {
    invalidate();
  }, [ghost, placing, invalidate]);

  // On each new snapshot, fold its events into the live beat list and wake the
  // demand loop so the new pulses (and the new mesh positions) get drawn.
  useEffect(() => {
    if (snapshot && snapshot.at !== lastAt.current) {
      lastAt.current = snapshot.at;
      const incoming = snapshot.events ?? [];
      if (incoming.length > 0) {
        const now = performance.now();
        beats.current = [...beats.current, ...incoming.map((e) => ({ ...e, spawn: now }))];
        invalidate(); // kick the demand loop awake to animate the new beats
      }
    }
  }, [snapshot, invalidate]);

  // Prune expired beats once per rendered frame, and keep the demand loop alive
  // while any beat is still animating (plus one trailing frame, so the per-mesh
  // useFrames reset their meshes to base once the last beat clears). When no
  // beats are live we stop invalidating, so the loop idles — zero GPU burn.
  useFrame(() => {
    const before = beats.current.length;
    if (before > 0) beats.current = activeBeats(beats.current, performance.now());
    if (beats.current.length > 0 || before > 0) invalidate();
  });

  // Per-site framing (Epic 04 P2): the active site's frame drives the FIXED
  // real-meters world→scene map (recenter + rotate + scale), so the framing never
  // jitters as the swarm moves and each site composes to its own hero pose. The
  // map is rebuilt only when the site changes, not per snapshot.
  const frame: SiteFrame = SITE_FRAMES[activeSite];
  const map = useMemo(() => siteMap(frame), [frame]);

  // Slice the snapshot to the active site (Epic 04 P2). `?? "lunar"` keeps an
  // untagged rover/task on the default site (back-compat), so a single-site
  // snapshot renders unchanged. The surface shows ONE site's swarm + structure.
  const siteRovers = useMemo(
    () =>
      snapshot
        ? snapshot.rovers.filter((r) => (r.site ?? "lunar") === activeSite)
        : [],
    [snapshot, activeSite],
  );
  const siteTasks = useMemo(
    () =>
      snapshot
        ? snapshot.tasks.filter((t) => (t.site ?? "lunar") === activeSite)
        : [],
    [snapshot, activeSite],
  );
  // Task lookup over the FILTERED tasks, so a lease beam only resolves a held task
  // within the active site (a cross-site beam would point off-frame).
  const taskById = useMemo(
    () => (snapshot ? new Map(siteTasks.map((t) => [t.id, t])) : null),
    [snapshot, siteTasks],
  );

  // `viewMode` here is the RENDERED mode (Scene3D's `shown`, which flips at the
  // glare peak). In orbit the worksite is hidden — you see only the Moon globe,
  // distant Earth, and stars — so it never floats as a square in space.
  const onSurface = viewMode === "surface";

  // ONE stable root for the whole scene (Epic 07 background-remount fix). The
  // snapshot-INDEPENDENT scenery (lights, environment grade, fog, the equirect
  // star background, and the sky bodies) is rendered unconditionally at the top of
  // a single <group>, and ONLY the snapshot-dependent worksite is gated below.
  //
  // Why this matters (load-bearing): SceneContents used to early-return a *Fragment*
  // before the first snapshot and a *<group>* after. React can't reconcile a
  // position whose root element type changes (Fragment ↔ group), so every time the
  // `!snapshot` guard flipped — which happens on the reload-demo board reset and on
  // transient/empty snapshots — it tore down and rebuilt the ENTIRE subtree,
  // remounting <SpaceEnvironment>. That re-ran <Starfield>'s `Math.random()`
  // useMemo([]) (a brand-new random starfield) and fired <StarBackground>'s
  // load-effect cleanup (which zeroes scene.backgroundRotation/intensity and
  // restores the black <color>) — the "stars change completely / Milky-Way band
  // disappears on every interaction" bug. Keeping the scenery at a fixed position
  // in one stable <group> means it mounts exactly once and survives every snapshot.
  return (
    <group>
      {/* SPACE LIGHTING rig (snapshot-independent). Per-site surface sun direction +
          intensity (Epic 04 P2): lunar high/bright, Shackleton low grazing/dim;
          `crater` raises the grazing pole-light tuning at Shackleton. See the
          SpaceLights definition above for the full physical rationale of each light
          and the Wave-4 decoupled-sun / dark-side-Moon tuning. */}
      <SpaceLights
        onSurface={onSurface}
        lightRef={lightRef}
        surfaceSunDir={frame.sunDir}
        surfaceSunIntensity={frame.sunIntensity}
        crater={activeSite === "shackleton"}
      />

      {/* Surface-only horizon fog — PER-SITE (Epic 04 P2): lunar warm deep grey,
          Shackleton tighter/darker for the pole. Skipped in orbit (the Moon globe
          stays crisp). */}
      {onSurface && <fog attach="fog" args={frame.fog} />}

      {/* Static, snapshot-independent backdrop: hand-rolled starfield + self-
          hosted HDR skybox/IBL (issue #50). Shown in BOTH views. Encodes no world
          state; gives metallic glTFs real reflections. `onSurface` swings the
          equirect band's per-view yaw so the bright dust stays framed on the
          surface instead of swinging behind (the descent flip is hidden by the
          glare peak). MUST stay mounted across snapshots — see the root comment. */}
      <SpaceEnvironment onSurface={onSurface} />

      {/* Decorative sky bodies (issue #51) — snapshot-INDEPENDENT Scenery: the
          Moon globe (orbit-only hero) + a distant Earth (both views) + the Sun
          (light emitter) + the clickable site markers (orbit-only). The
          Moon's appear/vanish is hidden behind the descent glare. */}
      <SkyBodies
        viewMode={viewMode}
        onSelectSite={onSelectSite}
        sunRef={sunRef}
        lockedSite={lockedSite}
        statusOverride={statusOverride}
      />

      {/* The WORKSITE — only in surface view AND once the first snapshot exists. In
          orbit it would float as a square in space ("moonbase lost in space"), so it
          is mounted only on the surface (the rendered mode flips under the glare, so
          the swap is unseen). Gated on `ready` here rather than in a separate return
          branch so the scenery above never remounts. */}
      {snapshot && taskById && onSurface && (
        <>
          <LunarTerrain
            terrainTint={frame.terrainTint}
            crater={activeSite === "shackleton"}
            skylight={activeSite === "lunar"}
          />

          {/* Shackleton long-shadow fakes (Epic 04 P4): static decals raking AWAY
              from the grazing pole sun. Snapshot-independent + procedural (no asset),
              so they never pop in on descent. Lunar's high key light needs none. */}
          {activeSite === "shackleton" && <ShackletonShadows />}

          {/* Lunar hero lava-tube skylight (#173): the dark void shaft + its ejecta
              boulder rim, SW of the worksite. LUNAR only — Shackleton has its crater.
              Snapshot-independent decoration; both are non-pickable (raycast off). */}
          {activeSite === "lunar" && (
            <>
              <LavaTubeSkylight />
              <LavaTubeBoulders />
              {/* Graded pads + rover tracks anchoring the composed base zones to
                  the regolith (Milestone 08, WS-2). Lunar only — Shackleton's
                  crater bowl already grounds its outpost. */}
              <LunarBaseDecals />
            </>
          )}

          {/* Contact shadows (#104) — drei bakes a soft ambient-occlusion-like
              contact shadow under the rovers + domes so they read as GROUNDED, not
              floating, even where the directional sun shadow is grazing. Sits a hair
              above the regolith (y=0.02) to avoid z-fighting the displaced plane.
              frames={1} bakes the shadow exactly ONCE (on the first rendered
              frame), so it never forces a continuous render loop — 0 idle fps holds.
              width/height span the ~±18-unit worksite detail zone; the soft blur +
              ~0.6 opacity keep it a subtle ground occlusion, not a hard disc. */}
          <ContactShadows
            position={[0, 0.02, 0]}
            scale={40}
            resolution={1024}
            far={6}
            blur={3}
            opacity={0.6}
            color="#000000"
            frames={1}
          />

          {/* Tasks / rising dome — ACTIVE SITE only (Epic 04 P2). */}
          {siteTasks.map((t) => (
            <TaskBlock key={t.id} task={t} map={map} geo={geo} beats={beats} />
          ))}

          {/* Lease beams (rover → held task), under the rovers — active site only. */}
          {siteRovers.map((r) => {
            if (!r.alive || !r.task) return null;
            const held = taskById.get(r.task);
            if (!held) return null;
            return <LeaseBeam key={`beam-${r.id}`} from={r} to={held} map={map} />;
          })}

          {/* Rovers — active site only. */}
          {siteRovers.map((r) => (
            <Rover3D
              key={r.id}
              rover={r}
              map={map}
              geo={geo}
              selected={selected === r.id}
              beats={beats}
              onPick={onPick}
            />
          ))}

          {/* Launch infrastructure set-pieces (#56) — static NASA-PD Scenery at the
              worksite edge. Snapshot-INDEPENDENT decoration, raycast-suppressed.
              Per-site pieces (Epic 04 P2): the two sites reuse the same GLBs but
              compose/retint them — Shackleton is a leaner, cooler outpost. */}
          <LaunchScenery pieces={frame.pieces} />

          {/* Launch-beat flare (#108): additive exhaust + godray billboards at the
              pad, hidden until a `launch` beat ramps them in useFrame. */}
          <LaunchFlare beats={beats} />

          {/* Decorative rock scatter removed for the cinematic — the worksite reads
              cleaner with just the NASA-PD set-pieces on the regolith (Epic 07). The
              DecorRocks component is kept (and its PBR textures still preload) so the
              field can be re-mounted per-site if a dressed look is wanted later. */}
        </>
      )}

      {/* Drag-to-place ghost + cursor plane (bh-05). Worksite-bound, so surface
          only. The plane is mounted only while placing; the ghost only once the
          cursor has hit the ground. */}
      {onSurface && ghost ? <BlueprintGhost ghost={ghost} map={map} /> : null}
      {onSurface && ghost ? (
        <PlacementTip ghost={ghost} map={map} invalidReason={placementInvalidReason} />
      ) : null}
      {onSurface && placing && onPlaceMove && onPlaceConfirm && onPlaceRotate ? (
        <PlacementPlane
          map={map}
          rotation={placementRotation}
          onMove={onPlaceMove}
          onConfirm={onPlaceConfirm}
          onRotate={onPlaceRotate}
        />
      ) : null}

      {/* Cinematic camera beats (#108): earthrise-hero framing + decaying launch
          shake. Reads the live beat list; idles (no camera motion) when no beat
          is active, so the demand loop stays at 0 fps. */}
      <CinematicCamera beats={beats} />

      {/* Cinematic post-processing stack (#99) — layer-gated bloom (halos +
          celestial Sun/Earth), SMAA, surface-gated DoF, orbit-only chromatic
          aberration, vignette, film grain. Rendered last; reads lightRef. All
          passes static (demand-loop safe). Supersedes the standalone HaloBloom —
          the halo SelectiveBloom is now one pass inside this stack, and it reads
          the live beats to spike intensity during a bid-war (#107). */}
      <CinematicFX lightRef={lightRef} sunRef={sunRef} onSurface={onSurface} beats={beats} />
    </group>
  );
}

// The exported renderer (sole worksite renderer, ADR-0004). A FIXED default
// orbit-camera angle frames the worksite; OrbitControls is
// allowed but clamped (no roll past the horizon, bounded zoom) so it can't be
// knocked into a useless pose on a projector. A click on empty space (the
// ground / background) deselects via onPointerMissed.
//
// frameloop="demand": the render loop is idle until something invalidates it —
// a new snapshot, an animating beat, or orbit interaction (OrbitControls is
// makeDefault, so drei invalidates on change + damping). dpr is capped at 1.5
// so a retina projector doesn't pay for 4× the pixels.
// OrbitControls' minimal surface that the transition driver mutates.
type OrbitLike = THREE.EventDispatcher & {
  target: THREE.Vector3;
  update: () => void;
  enabled: boolean;
};

// RigBridge lives INSIDE the Canvas and exposes the live camera / OrbitControls /
// invalidate to the OUT-OF-Canvas transition driver in Scene3D via refs. (The
// driver runs a plain requestAnimationFrame loop — not a useFrame — so it must
// reach these through refs.) It captures them on every commit so a late-mounting
// OrbitControls (makeDefault) is picked up as soon as it exists. Renders nothing.
function RigBridge({
  cameraRef,
  controlsRef,
  invalidateRef,
}: {
  cameraRef: React.MutableRefObject<THREE.Camera | null>;
  controlsRef: React.MutableRefObject<OrbitLike | null>;
  invalidateRef: React.MutableRefObject<(() => void) | null>;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitLike | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    cameraRef.current = camera;
    controlsRef.current = controls;
    invalidateRef.current = invalidate;
  });
  return null;
}

// PlacementGestureGuard suppresses the browser context menu on the canvas WHILE a
// blueprint placement is active (Epic 06 P1, #151), so the right-drag-rotate gesture
// never pops the OS menu mid-drag (Risk #1). Lives inside the Canvas to reach the
// live `gl.domElement`. The listener is added ONLY while `placing` and removed in the
// effect cleanup — scoped tight so right-click works normally everywhere else and at
// rest. Renders nothing; the camera lock itself is the declarative OrbitControls
// `enableRotate={!placing}` + `enablePan={false}` (zoom stays live), which self-
// restores when `placing` flips false (no imperative controls.enabled to leak).
function PlacementGestureGuard({ placing }: { placing: boolean }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!placing) return;
    const el = gl.domElement;
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("contextmenu", onContextMenu);
    return () => el.removeEventListener("contextmenu", onContextMenu);
  }, [placing, gl]);
  return null;
}

// CameraFeel — slice #109. Decorative camera polish that NEVER touches the
// snapshot (ADR-0004 purity intact): a gentle idle azimuth sway after ~4s of no
// input, a zoom-coupled tone-mapping-exposure lift, and a subtle starfield
// parallax as the orbit azimuth moves. The actual numbers are pure helpers in
// lib/cameraFeel.ts; this component only wires them to the live camera/scene.
//
// Demand-loop discipline (Wave-3 relaxation): the idle sway is the only piece
// that needs an ongoing loop, so it self-sustains by calling invalidate() each
// frame WHILE drifting and STOPS (returns to 0 idle fps) the moment the user
// interacts OR the tab is hidden. Exposure + parallax are cheap reads applied on
// frames the loop is already painting (interaction, drift, snapshots), so they
// add no idle cost of their own. A timer wakes the loop once at the 4s mark so
// the drift can begin from a fully-settled, otherwise-idle scene.
//
// `active` is false while placing or during the descent transition — those own
// the camera — so the feel layer stays out of their way.
// The OrbitControls surface CameraFeel reads/subscribes to. Kept as a hand-rolled
// interface (rather than OrbitLike, whose EventDispatcher event-map types the
// listener param as `never`) with a loose, string-keyed add/removeEventListener.
type FeelControls = {
  target: THREE.Vector3;
  enabled: boolean;
  minDistance: number;
  maxDistance: number;
  getDistance: () => number;
  getAzimuthalAngle: () => number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

function CameraFeel({ active, onSurface }: { active: boolean; onSurface: boolean }) {
  const controls = useThree((s) => s.controls) as FeelControls | null;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const domElement = gl.domElement;

  // Mutable feel state, kept in refs so it never triggers a React re-render.
  // Timestamp of the last user input; the idle clock counts up from here.
  const lastInputRef = useRef<number>(performance.now());
  // The azimuth captured the first idle frame; the sway oscillates AROUND it and
  // it's cleared on every interaction so the next idle re-captures from wherever
  // the user left the camera. null = not currently drifting.
  const restAzimuthRef = useRef<number | null>(null);
  // The settled camera offset (position − target) at rest; the idle sway rotates
  // a CLONE of this around the target's up-axis so amplitude can't accumulate.
  const restOffsetRef = useRef(new THREE.Vector3());
  // True between OrbitControls 'start' and 'end' (a drag/zoom in progress). The
  // idle sway is suppressed while dragging so a long (>4s) continuous drag can't
  // start drifting under the user's own gesture.
  const draggingRef = useRef(false);
  // --- starfield parallax state (trailing model; see cameraFeel.advanceParallax) ---
  // The yaw offset (radians) currently applied to the dim points starfield. It
  // trails the camera azimuth and relaxes back to 0 — there is no anchor to reset,
  // so it can't snap. We OWN this object's rotation.y outright (nothing else sets
  // it), so we write it absolutely rather than as a relative delta.
  const parallaxRef = useRef(0);
  // Last frame's azimuth, to derive the per-frame delta. null until the first
  // frame captures it (so the first delta is 0, never a spurious jump).
  const lastAzimuthRef = useRef<number | null>(null);
  // Cached lookup of the points layer (mounts via SpaceEnvironment, possibly after
  // this component). Re-resolved each frame until found, then reused.
  const starsRef = useRef<THREE.Object3D | null>(null);

  useEffect(() => {
    if (!controls || !active) return;

    const markInput = () => {
      lastInputRef.current = performance.now();
      // Cancel any in-progress sway instantly; the next idle frame re-captures.
      restAzimuthRef.current = null;
      // Schedule a single wake at the idle threshold so the drift can start even
      // when nothing else is invalidating (a fully-settled scene).
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => invalidate(), IDLE_DELAY_MS + 16);
    };
    // A gesture begins: mark input and flag the drag so drift stays suppressed
    // for its whole duration (however long the user holds it).
    const onStart = () => {
      draggingRef.current = true;
      markInput();
    };
    // A gesture ends (release / wheel settle): clear the flag and RESTART the
    // idle clock from the release moment, so the ~4s countdown is measured from
    // when the user actually stopped — not from when the gesture began.
    const onEnd = () => {
      draggingRef.current = false;
      markInput();
    };

    // User-input signals only (NOT OrbitControls' 'change', which our own idle
    // update() would re-fire and pin the loop awake forever). 'start'/'end' frame
    // each gesture; the raw DOM events cover the very first touch and wheel.
    let idleTimer = 0;
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    domElement.addEventListener("pointerdown", markInput);
    domElement.addEventListener("wheel", markInput, { passive: true });
    domElement.addEventListener("touchstart", markInput, { passive: true });

    // Tab visibility: while hidden the useFrame is parked (no invalidate), so the
    // drift pauses and idle fps drops to 0. On RETURN, treat it like fresh input
    // so the idle clock restarts from now (no phase jump) and the wake is re-armed.
    const onVisibility = () => {
      if (!document.hidden) markInput();
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Recapture the rest pose on (re)activation. CameraFeel deactivates during a
    // transition/placement (active=false) and reactivates when it ends — but a
    // view toggle is a BUTTON click, not a canvas gesture, so markInput never
    // fires and restAzimuthRef would still hold the rest pose captured at the
    // PREVIOUS view's camera. Left stale, the first idle frame would rebuild the
    // camera as `controls.target + staleOffset`, yanking it off the pose the
    // transition just settled on (the old "snaps to a wrong orbit/surface pose
    // right after the toggle" bug). Null it so the next idle frame recaptures the
    // offset from the freshly-settled camera. (markInput also nulls it on input.)
    restAzimuthRef.current = null;
    // Immediate-idle init (05-P2): backdate the last-input stamp by the full
    // idle delay so idleElapsed > 0 from the very first frame and the sway eases
    // in right away (IDLE_FADE_MS still ramps the amplitude, so there is no
    // snap). Scene3D now mounts only after the splash, so this is the reveal
    // moment — the drift begins exactly when the user first sees the vista. Only
    // the initial behavior changes: markInput (start/end/DOM input) still arms
    // the normal ~4s delay after any interaction.
    lastInputRef.current = performance.now() - IDLE_DELAY_MS;
    // Still schedule a wake so the drift can start in a fully-settled scene.
    idleTimer = window.setTimeout(() => invalidate(), 16);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      domElement.removeEventListener("pointerdown", markInput);
      domElement.removeEventListener("wheel", markInput);
      domElement.removeEventListener("touchstart", markInput);
      document.removeEventListener("visibilitychange", onVisibility);
      if (idleTimer) clearTimeout(idleTimer);
      // Return the star layer to its framed orientation when the feel layer
      // deactivates (placing / transitioning own the camera), and reset the
      // trailing state so it re-arms cleanly on the next activation.
      const stars = starsRef.current ?? scene.getObjectByName(STARFIELD_PARALLAX_NAME);
      if (stars) stars.rotation.y = 0;
      parallaxRef.current = 0;
      lastAzimuthRef.current = null;
    };
  }, [controls, domElement, invalidate, active, scene]);

  // Reusable scratch so the per-frame path allocates nothing.
  const qRef = useRef(new THREE.Quaternion());
  const offRef = useRef(new THREE.Vector3());

  useFrame((_, dt) => {
    if (!controls || !active) return;
    // Pause ALL idle motion while the tab is hidden — never wake the loop when
    // nothing is visible (the Wave-3 visibility guard).
    if (typeof document !== "undefined" && document.hidden) return;

    // --- zoom-coupled exposure (cheap read; applied every painted frame) ------
    // Orbit is scaled down (ORBIT_EXPOSURE_SCALE) so the deep-space vista reads
    // darker — the sunlit limb + celestial bloom stop blowing out and the void
    // rolls to black. Surface stays at full exposure for worksite legibility.
    gl.toneMappingExposure =
      zoomExposure(
        controls.getDistance(),
        controls.minDistance,
        controls.maxDistance,
      ) * (onSurface ? SURFACE_EXPOSURE_SCALE : ORBIT_EXPOSURE_SCALE);

    const azimuth = controls.getAzimuthalAngle();

    // --- idle sway ------------------------------------------------------------
    // Suppressed while a gesture is in progress (draggingRef) so the user's own
    // drag is never fought; only kicks in once they've settled for ~4s.
    const idleElapsed = performance.now() - lastInputRef.current - IDLE_DELAY_MS;
    if (idleElapsed > 0 && !draggingRef.current) {
      // Capture the rest pose on the first idle frame so the sway oscillates
      // around where the user left the camera.
      if (restAzimuthRef.current === null) {
        restAzimuthRef.current = azimuth;
        restOffsetRef.current.copy(camera.position).sub(controls.target);
      }
      const sway = idleSwayOffset(idleElapsed);
      // Rotate the rest offset around the target's up-axis by the sway angle and
      // reposition the camera; drei's OrbitControls.update() (same frame) reads
      // this as the new baseline, so it sticks with no damping fight.
      const off = offRef.current.copy(restOffsetRef.current);
      off.applyQuaternion(qRef.current.setFromAxisAngle(camera.up, sway));
      camera.position.copy(controls.target).add(off);
      // Keep the demand loop alive for the next sway frame.
      invalidate();
    }

    // --- starfield parallax ---------------------------------------------------
    // Trail the dim points layer behind the camera azimuth (the bright equirect
    // band stays locked). A velocity model: nudge opposite this frame's azimuth
    // turn, relax back to neutral. No anchor → no snap. We keep invalidating while
    // the offset is still easing back so it settles even after OrbitControls and
    // the idle sway have both gone quiet.
    const stars =
      starsRef.current ??
      (starsRef.current = scene.getObjectByName(STARFIELD_PARALLAX_NAME) ?? null);
    if (stars) {
      const last = lastAzimuthRef.current;
      const azimuthDelta = last === null ? 0 : azimuth - last;
      lastAzimuthRef.current = azimuth;
      const next = advanceParallax(parallaxRef.current, azimuthDelta, dt);
      parallaxRef.current = next;
      stars.rotation.y = next;
      if (Math.abs(next) > PARALLAX_SETTLE_EPS) invalidate();
    }
  });

  return null;
}

// Stable no-op for optional callbacks used as effect deps (a fresh `() => {}` each
// render would re-run the effect). Module-level so its identity never changes.
const NOOP = () => {};

// CinematicOpen — the orbit-open camera-arc rig (Epic 07 S5 · #158, Beats 1–2
// "WANDERING" + "SUN REVEAL"). The film's opening Scenery beat: "lost in the dark,
// found by the sun." A scene-mounted rig driven by a PROP FLAG (the same pattern as
// CameraFeel above — NOT an imperative camera handle), so it respects the one-effect-
// owns-the-camera invariant.
//
// While `active`, it drifts the camera laterally along the Moon's dark limb (sun
// off-frame) and then ARCS the CAMERA so the *fixed* sun's GodRays + celestial bloom
// crest into frame, easing into ORBIT_POSE. The motion is a CAMERA azimuth offset
// (lib/reel/openArc.openAzimuthOffset) applied by rotating the settled ORBIT_POSE
// offset around the target's up-axis — CAMERA-ARC, NOT SUN-ARC (grilling outcome 5):
// the sun STAYS at ORBIT_SUN_POSITION (moving it would be physically wrong + snapshot-
// independent motion). It runs under frameloop="always" (ADR-0004 Wave-4) and invents
// ZERO snapshot/wire fields (pure decorative Scenery, ADR-0004 purity intact).
//
// Transition discipline: while running it calls `onTransition(true)` so Scene3D sets
// `transitioning` — which deactivates CameraFeel (its idle sway can't fight the arc)
// and disables OrbitControls rotate. It ALSO owns `controls.enabled=false` directly
// (mirrors runDescent). On completion OR cancel (prop flips false / unmount), it
// settles EXACTLY on ORBIT_POSE, re-enables controls, and calls `onTransition(false)`
// so CameraFeel re-arms and idle drift eases back in — no stuck-disabled controls, no
// leaked state. The cleanup runs on EVERY teardown, so cancelling mid-arc restores
// cleanly to the framed orbit pose (never a half-rotated camera).
//
// FALLBACK (script-sanctioned, Beats 1–2): if this cue is never fired, the orbit
// behaves EXACTLY as today — a cold static ORBIT_POSE hold + idle sway, and the
// "found by light" read moves to the descent glare (Beat 4). The rig is inert when
// `active` is false, so it NEVER blocks the rest of the film. Only meaningful in
// orbit; on the surface it no-ops (the open is an orbit vista beat).
function CinematicOpen({
  active,
  onSurface,
  onTransition,
  onDone,
}: {
  active: boolean;
  onSurface: boolean;
  onTransition: (running: boolean) => void;
  // Fire-once: called when the arc finishes OR is interrupted, so the upstream
  // `cinematicOpen` flag disarms and the arc can't re-trigger on the next return
  // to orbit (the ascent bookend). Must be STABLE — it's an effect dependency.
  onDone: () => void;
}) {
  const controls = useThree((s) => s.controls) as FeelControls | null;
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    // Inert unless armed-and-triggered AND in orbit (the open is an orbit vista
    // beat). On the surface or when not cued, do nothing — the orbit is untouched
    // (the cold-hold fallback) and controls/CameraFeel keep their current state.
    if (!active || onSurface || !controls || !camera) return;

    // Capture the LIVE target + horizontal berth at the moment the cue fires. The
    // equirect background is sampled by camera orientation, so preserving the live
    // X/Z offset avoids the old azimuth snap that rotated the warm dust band away.
    // The Y offset is intentionally restored to ORBIT_POSE's startup elevation:
    // regardless of a prior polar drag, the reveal sees the Sun and Moon with the
    // same vertical alignment as the default app view.
    const startTarget = controls.target.clone();
    const startPos = camera.position.clone();
    const liveOffset = startPos.clone().sub(startTarget);
    const defaultOffset = ORBIT_POSE.position.clone().sub(ORBIT_POSE.target);
    const alignedOffset = alignOpenCameraElevation(
      [liveOffset.x, liveOffset.y - 10, liveOffset.z],
      [defaultOffset.x, defaultOffset.y -20, defaultOffset.z],
    );
    // The arc rotates this aligned offset around the target's up-axis. Its elevation
    // stays fixed at the startup value while only azimuth changes (CAMERA-ARC, not
    // sun-arc); the final pose retains the live horizontal framing.
    const restOffset = new THREE.Vector3(...alignedOffset);
    const settledPos = startTarget.clone().add(restOffset);
    const up = camera.up.clone(); // world-up (0,1,0) in orbit — the azimuth axis
    const tmpOffset = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();

    // We own the camera for the duration: disable controls and tell Scene3D we're
    // transitioning (deactivates CameraFeel, disables OrbitControls rotate). Mirrors
    // runDescent's discipline so the two rigs never fight over the camera.
    controls.enabled = false;
    onTransition(true);

    let raf = 0;
    let start = 0;
    let cancelled = false;
    // True once the arc has run to completion and handed the camera back. Guards the
    // cleanup from re-snapping the camera to ORBIT_POSE on a LATER teardown (e.g. the
    // operator toggles the cue off, or orbits away then unmounts) — after a natural
    // finish there is nothing to cancel, so the cleanup must not yank the camera.
    let finished = false;

    const apply = (t: number) => {
      const azOffset = openAzimuthOffset(t);
      tmpOffset.copy(restOffset).applyQuaternion(tmpQuat.setFromAxisAngle(up, azOffset));
      camera.position.copy(startTarget).add(tmpOffset);
      camera.up.set(0, 1, 0);
      camera.lookAt(startTarget);
      // Keep OrbitControls' target on the Moon so it resumes from the framed pose.
      controls.target.copy(startTarget);
      invalidate();
    };

    const step = (now: number) => {
      if (cancelled) return;
      if (!start) start = now;
      const t = Math.min(1, (now - start) / OPEN_MS);
      apply(t);
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        // Settle EXACTLY on the aligned rest pose (openAzimuthOffset(1) === 0, but
        // snap so there is zero residual), re-enable controls, and hand the camera
        // back to CameraFeel. The live azimuth keeps the backdrop continuous while
        // the canonical Y keeps the Sun/Moon composition matched to app startup.
        finish();
      }
    };

    const finish = () => {
      finished = true;
      camera.position.copy(settledPos);
      camera.up.set(0, 1, 0);
      camera.lookAt(startTarget);
      controls.target.copy(startTarget);
      controls.enabled = true;
      onTransition(false);
      // One-shot: disarm so the arc plays exactly once. Returning to orbit later
      // (the ascent bookend) must NOT replay it — that re-fire captured a
      // mid-ascent pose and fought the ascent driver (flicker + stuck-close Moon).
      onDone();
      invalidate();
    };

    raf = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      // If the arc already finished naturally, `finish()` settled + handed the camera
      // back to CameraFeel/OrbitControls — there is nothing to cancel, so DON'T touch
      // the camera (the operator may have orbited away since). Only an INTERRUPTED arc
      // (prop flips false / unmount mid-run) needs the restore: settle back to the
      // aligned rest pose and re-enable controls so nothing is left stuck-disabled
      // or half-rotated.
      if (!finished) {
        if (controls) {
          camera.position.copy(settledPos);
          camera.up.set(0, 1, 0);
          camera.lookAt(startTarget);
          controls.target.copy(startTarget);
          controls.enabled = true;
        }
        onTransition(false);
        // Disarm on interruption too (e.g. descent started mid-arc): a one-shot
        // intro should not resume/replay when the view next returns to orbit.
        onDone();
        invalidate();
      }
    };
  }, [active, onSurface, controls, camera, invalidate, onTransition, onDone]);

  return null;
}

// The canonical settled pose for a (view, site) pair — the start/end of every
// transition. Orbit is site-agnostic (one Moon vista for both markers); the
// surface picks the active site's framing (Epic 04 P4: Shackleton lower/back).
export const poseFor = (m: ViewMode, site: SiteId = "lunar"): Pose =>
  m === "orbit"
    ? ORBIT_POSE
    : site === "shackleton"
      ? SHACKLETON_SURFACE_POSE
      : LUNAR_SURFACE_POSE;

export function Scene3D({
  snapshot,
  selected,
  onPick,
  placing,
  ghost,
  placementRotation = 0,
  placementInvalidReason = null,
  onPlaceMove,
  onPlaceConfirm,
  onPlaceRotate,
  viewMode = "surface",
  onViewModeChange,
  activeSite = "lunar",
  onActiveSiteChange,
  lockedSite,
  statusOverride,
  cinematicOpen,
  onCinematicOpenDone,
}: Scene3DProps) {
  // Initial camera pose, seeded to the DEFAULT view so the app opens already
  // framed on it. The Canvas `camera` prop is applied ONCE on mount, so this is
  // captured from the first viewMode and never changes identity. When the app
  // opens in orbit (the current default), seed ORBIT_POSE so the very first frame
  // is the settled Moon vista — without this the camera mounts at the surface
  // default and OrbitControls clamps it against the orbit target into a dark,
  // off-centre Moon (it did not match the pose a surface→orbit toggle settles on).
  // Surface default keeps the rehearsed worksite seat; the #108 intro flies it in.
  const initialCamera = useRef({
    position: (viewMode === "orbit"
      ? [ORBIT_POSE.position.x, ORBIT_POSE.position.y, ORBIT_POSE.position.z]
      : [SURFACE_POSE.position.x, SURFACE_POSE.position.y, SURFACE_POSE.position.z]) as [
      number,
      number,
      number,
    ],
    fov: 50,
    near: 0.1,
    far: 8000,
  }).current;

  // `viewMode`/`activeSite` (props) are the DESIRED state; `shown`/`shownSite` are
  // what is currently RENDERED. They differ only DURING a transition: each flips at
  // its glare peak, so the content/sky swap is hidden behind the flash. Clamps + the
  // OrbitControls target track `shown` so they always match the visible scene. The
  // pair is generalized (Epic 04 P4) so ONE driver, keyed on [viewMode, activeSite],
  // owns both the view change (descent/ascent) and the surface→surface site swap
  // (match-cut) — two separate effects would race over the camera (Risk #3).
  const [shown, setShown] = useState<ViewMode>(viewMode);
  const shownRef = useRef<ViewMode>(viewMode);
  const [shownSite, setShownSite] = useState<SiteId>(activeSite);
  const shownSiteRef = useRef<SiteId>(activeSite);
  const [transitioning, setTransitioning] = useState(false);

  // The orbit-open rig (#158) reuses the SAME `transitioning` discipline as the
  // descent/traverse runners: while it owns the camera it flips `transitioning` so
  // CameraFeel stands down and OrbitControls rotate is disabled, then clears it on
  // settle so idle drift eases back in (one-effect-owns-the-camera). Memoised so the
  // rig's effect (which depends on it) doesn't re-run on unrelated re-renders.
  const runOpenTransition = useCallback((running: boolean) => {
    setTransitioning(running);
  }, []);

  // Live handles to the in-Canvas camera/controls/invalidate, captured by RigBridge.
  const cameraRef = useRef<THREE.Camera | null>(null);
  const controlsRef = useRef<OrbitLike | null>(null);
  const invalidateRef = useRef<(() => void) | null>(null);
  // The full-screen glare overlay (DOM). Driven by direct style mutation (no React
  // re-render per frame) so the demand loop is never woken by React state churn.
  const glareRef = useRef<HTMLDivElement>(null);

  // Glare-masked descent runner (#84, reused by #108). Flies the camera in two
  // eased half-beats through a white sunlit flash that masks the scene swap. Runs
  // a plain rAF loop (NOT a useFrame) only for its `durationMs`, invalidating each
  // tick; when idle nothing renders, so the demand loop stays at 0 fps. Returns a
  // cleanup that cancels the rAF and re-enables controls if interrupted. The
  // CINEMATIC INTRO (#108) reuses this exact rig — an orbit→surface descent
  // stretched to ~4.5s — so the experience opens from deep space.
  const runDescent = useRef<
    (from: ViewMode, to: ViewMode, durationMs: number, toSite?: SiteId) => () => void
  >(() => () => {});
  runDescent.current = (from, to, durationMs, toSite = shownSiteRef.current) => {
    const camera = cameraRef.current;
    const invalidate = invalidateRef.current;
    const controls = controlsRef.current;
    // Rig not ready yet (shouldn't happen after first mount): snap, no animation.
    if (!camera || !invalidate) {
      shownRef.current = to;
      setShown(to);
      shownSiteRef.current = toSite;
      setShownSite(toSite);
      return () => {};
    }

    // Beat 1 flies toward the Moon (descent) or lifts off the worksite (ascent);
    // beat 2 settles into the destination once the content has swapped under the
    // glare. Beat 1 starts from wherever the user actually left the camera.
    const startPose: Pose = {
      position: camera.position.clone(),
      target: controls
        ? controls.target.clone()
        : poseFor(from, shownSiteRef.current).target.clone(),
    };
    const beat1To = to === "surface" ? MOON_CLOSE_POSE : SURFACE_HIGH_POSE;
    const beat2From = to === "surface" ? SURFACE_HIGH_POSE : MOON_CLOSE_POSE;
    // On a descent the dest is the TARGET site's surface pose (orbit-marker click
    // lands there); on an ascent the site is irrelevant (orbit is site-agnostic).
    const destPose = poseFor(to, toSite);

    // Descent vs. ascent. The pitch ramp (#84) puts the horizon-rise in the FINAL
    // ~15% of the whole move on a descent (beat 2, t∈[0.85,1] → its last 30%), and
    // mirrors it on an ascent (the horizon drops in beat 1's last 30%). pitchHold
    // is the fraction of that beat held at the near-nadir aim before the ramp.
    const descending = to === "surface";
    const DESCENT_PITCH_HOLD = 0.7; // ramp the look-up over the beat's final 30%
    // Lateral arc + roll (#84): a small X drift so foreground/background features
    // parallax (reads as real 3D, not a straight Z-dive) and a tiny roll, both a
    // half-sine bump that is ZERO at depart and arrival. ascent mirrors the sign.
    const ARC_X = descending ? 14 : -14; // scene units of lateral drift at mid-flight
    const ROLL_MAX = THREE.MathUtils.degToRad(2.2) * (descending ? 1 : -1); // ≤3°, zeroed at arrival

    const tmpPos = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();
    let raf = 0;
    let start = 0;
    let swapped = false;
    if (controls) controls.enabled = false; // we own the camera for the duration
    setTransitioning(true);

    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);

      // Slim glare (#84): a BRIEF off-center sun-bloom that only fully occludes the
      // scene swap for a few frames, rather than a full triangular wash. A narrow
      // window around the t=0.5 swap, raised to a power so it spikes to 1 and falls
      // off fast (off-center bloom shape lives in the .view-glare CSS gradient).
      const GLARE_HALF = 0.16; // window half-width (~5 frames each side at 60fps over 1.5s)
      const gx = Math.max(0, 1 - Math.abs(t - 0.5) / GLARE_HALF);
      if (glareRef.current) glareRef.current.style.opacity = String(Math.pow(gx, 1.6));

      if (t < 0.5) {
        // Beat 1 — depart: ease-in (slow start, accelerating away). On ASCENT this
        // beat owns the pitch change (horizon drops as we lift off).
        const k = easeInQuad(t / 0.5);
        lerpPose(startPose, beat1To, k, tmpPos, tmpTgt, descending ? 1 : DESCENT_PITCH_HOLD);
      } else {
        if (!swapped) {
          swapped = true;
          shownRef.current = to;
          setShown(to); // swap content + sky under the brief full-glare peak
          // Land on the target site too (orbit-marker click descends to it). On an
          // ascent toSite == the current site, so this is a no-op.
          shownSiteRef.current = toSite;
          setShownSite(toSite);
        }
        // Beat 2 — arrive: ease-out (fast in, hard deceleration into the landing).
        // On DESCENT this beat owns the pitch ramp (horizon rises in its last 30%).
        const k = easeOutQuint((t - 0.5) / 0.5);
        lerpPose(beat2From, destPose, k, tmpPos, tmpTgt, descending ? DESCENT_PITCH_HOLD : 1);
      }

      // Lateral arc + roll as a half-sine bump: 0 at the ends, max at mid-flight,
      // so the camera curves through the move and the roll is fully zeroed by
      // arrival. The X drift is added AFTER the lerp so it offsets the eased path.
      const bump = Math.sin(t * Math.PI);
      tmpPos.x += ARC_X * bump;
      camera.position.copy(tmpPos);
      camera.lookAt(tmpTgt);
      camera.rotateZ(ROLL_MAX * bump);
      if (controls) controls.target.copy(tmpTgt);
      invalidate();

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (glareRef.current) glareRef.current.style.opacity = "0";
        // Settle exactly on the destination pose: bump/roll are 0 at t=1, but snap
        // the camera/orbit target cleanly so OrbitControls resumes from the canon
        // pose with no residual roll (controls.update reasserts the up-vector).
        camera.position.copy(destPose.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(destPose.target);
        if (controls) {
          controls.target.copy(destPose.target);
          controls.enabled = true;
          controls.update();
        }
        setTransitioning(false);
        invalidate(); // final settled frame, then the loop idles
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (glareRef.current) glareRef.current.style.opacity = "0";
      if (controls) controls.enabled = true; // never leave controls disabled if interrupted
    };
  };

  // Surface→surface GROUND-DRIVE runner. Instead of a lateral cut, the camera dives
  // near the surface and RACES across the open regolith: beat 1 skims out toward the
  // horizon, the rendered site is swapped under a dust-brownout peak (t=0.5), and
  // beat 2 races back in and settles on the destination surface pose — for Shackleton
  // that pose crests the carved rim, so the drive arrives by descending INTO the
  // crater. Same rig discipline as runDescent: it OWNS the camera (controls disabled),
  // `transitioning` suspends CameraFeel's input clock so the tween doesn't fight the
  // idle drift, and at t=1 it settles EXACTLY on the dest pose, re-enables controls,
  // and clears `transitioning` so CameraFeel re-arms and eases idle drift back in (no
  // snap — #130 handoff). The dust veil reuses the glare overlay div with a `.view-
  // dust` class (a warm regolith brownout instead of the white sun-flash).
  const runTraverse = useRef<(toSite: SiteId, durationMs: number) => () => void>(
    () => () => {},
  );
  runTraverse.current = (toSite, durationMs) => {
    const camera = cameraRef.current;
    const invalidate = invalidateRef.current;
    const controls = controlsRef.current;
    // Rig not ready: snap the site with no animation.
    if (!camera || !invalidate) {
      shownSiteRef.current = toSite;
      setShownSite(toSite);
      return () => {};
    }

    // Start from wherever the camera actually is (it may be mid-idle-drift — #130),
    // so the drive takes the camera CLEANLY from the drifting state. Dest is the
    // destination site's settled surface pose.
    const startPose: Pose = {
      position: camera.position.clone(),
      target: controls
        ? controls.target.clone()
        : poseFor("surface", shownSiteRef.current).target.clone(),
    };
    const destPose = poseFor("surface", toSite);

    // The drive heads OUT into the open plain (toward the fogged horizon, −z with a
    // slight +x so it reads as travel) and back. Both worksites recenter onto the
    // origin, so the journey is fabricated by racing across the empty 700-unit plain;
    // the dust veil hides the site swap at the far point, and the crater gives the
    // arrival a real destination. The two skim poses are low (SKIM_ALTITUDE) so the
    // regolith streams past the camera like a ground vehicle.
    const heading = new THREE.Vector3(0.15, 0, -1).normalize();
    const skimOut: Pose = {
      position: heading.clone().multiplyScalar(SKIM_OUT_DIST).setY(SKIM_ALTITUDE),
      target: heading.clone().multiplyScalar(SKIM_OUT_DIST + 40).setY(2),
    };
    const skimIn: Pose = {
      position: heading.clone().multiplyScalar(SKIM_OUT_DIST).setY(SKIM_ALTITUDE),
      target: destPose.target.clone(),
    };

    const tmpPos = new THREE.Vector3();
    const tmpTgt = new THREE.Vector3();
    let raf = 0;
    let start = 0;
    let swapped = false;
    if (controls) controls.enabled = false; // own the camera for the drive
    setTransitioning(true); // suspends CameraFeel + OrbitControls rotate
    if (glareRef.current) glareRef.current.classList.add("view-dust"); // warm dust veil

    const step = (now: number) => {
      if (!start) start = now;
      const t = Math.min(1, (now - start) / durationMs);
      const env = traverseEnvelope(t);

      if (glareRef.current) glareRef.current.style.opacity = String(env.veil);

      if (env.swapped && !swapped) {
        swapped = true;
        // Swap the rendered site (content + lighting + fog + scenery + crater) under
        // the dust peak, so the drive never glimpses the change.
        shownSiteRef.current = toSite;
        setShownSite(toSite);
      }

      if (t < 0.5) {
        // Beat 1 — dive + race OUT across the regolith (ease-in: accelerate away).
        lerpPose(startPose, skimOut, easeInQuad(t / 0.5), tmpPos, tmpTgt, 1);
      } else {
        // Beat 2 — race back IN and settle (ease-out: hard decel into the landing).
        // pitchHold=0.7 holds the low ground aim, then pitches onto the dest target
        // in the final ~30% so for Shackleton the look-down into the crater resolves
        // right at the rim crest (the reveal).
        lerpPose(skimIn, destPose, easeOutQuint((t - 0.5) / 0.5), tmpPos, tmpTgt, 0.7);
      }
      camera.position.copy(tmpPos);
      camera.lookAt(tmpTgt);
      if (controls) controls.target.copy(tmpTgt);
      invalidate();

      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        if (glareRef.current) {
          glareRef.current.style.opacity = "0";
          glareRef.current.classList.remove("view-dust");
        }
        // Settle EXACTLY on the destination pose so OrbitControls + CameraFeel resume
        // from the canon pose with no snap and no drift-fight.
        camera.position.copy(destPose.position);
        camera.up.set(0, 1, 0);
        camera.lookAt(destPose.target);
        if (controls) {
          controls.target.copy(destPose.target);
          controls.enabled = true;
          controls.update();
        }
        setTransitioning(false); // re-arms CameraFeel; idle drift eases back in
        invalidate();
      }
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      if (glareRef.current) {
        glareRef.current.style.opacity = "0";
        glareRef.current.classList.remove("view-dust"); // never leave the dust veil stuck
      }
      if (controls) controls.enabled = true; // never leave controls disabled if interrupted
    };
  };

  // SINGLE transition driver (Epic 04 P4) — keyed on [viewMode, activeSite] so ONE
  // effect owns every transition and two effects can never race the camera (Risk
  // #3). Three branches:
  //   1. view changed (orbit↔surface): the glare-masked descent/ascent. If the site
  //      ALSO changed (orbit-marker click → site + surface), descend to that site.
  //   2. same view (surface) + site changed: the lateral glare MATCH-CUT.
  //   3. same view (orbit) + site changed: orbit is site-agnostic — just sync the
  //      shown site silently (no camera move; the markers don't depend on it).
  useEffect(() => {
    const toView = viewMode;
    const fromView = shownRef.current;
    const toSite = activeSite;
    const fromSite = shownSiteRef.current;
    if (toView !== fromView) {
      // Branch 1 (+3-combined): descend/ascend; on a descent land on the target site.
      return runDescent.current(fromView, toView, TRANSITION_MS, toSite);
    }
    if (toSite === fromSite) return; // nothing changed
    if (toView === "surface") {
      // Branch 2: surface→surface site swap — the cinematic ground drive.
      return runTraverse.current(toSite, TRAVERSE_MS);
    }
    // Branch 3: orbit + site change — no visible camera move; sync silently.
    shownSiteRef.current = toSite;
    setShownSite(toSite);
    // Driven by [viewMode, activeSite]; the runner refs + setters are stable.
  }, [viewMode, activeSite]);

  // CINEMATIC INTRO FLY-IN (#108): on first mount in surface view, open from deep
  // space — reuse the descent rig (orbit→surface) stretched to ~4.5s so the
  // experience arrives, rather than cutting in flat. Runs exactly ONCE; if the rig
  // isn't ready on the first effect tick we retry on the next animation frame
  // (RigBridge captures the camera/controls on commit, which may land after this
  // effect). Controls are disabled by the rig for the duration, then restored.
  const introPlayed = useRef(false);
  useEffect(() => {
    // Only auto-fly-in when the app opens directly on the surface (the default).
    // If it opens in orbit, the user's own toggle drives the first descent instead.
    if (introPlayed.current || viewMode !== "surface") return;
    let cleanup: (() => void) | undefined;
    let raf = 0;
    const tryStart = () => {
      if (introPlayed.current) return;
      // Wait for the rig; without a live camera the descent would just snap.
      if (!cameraRef.current || !invalidateRef.current) {
        raf = requestAnimationFrame(tryStart);
        return;
      }
      introPlayed.current = true;
      // Render the surface immediately (shown is already "surface"), but fly the
      // camera in from the orbit vantage — `from` only seeds the look target, and
      // the start position is read live from the camera, so seed it at orbit.
      const camera = cameraRef.current;
      camera.position.set(ORBIT_POSE.position.x, ORBIT_POSE.position.y, ORBIT_POSE.position.z);
      cleanup = runDescent.current("orbit", "surface", INTRO_MS);
    };
    tryStart();
    return () => {
      cancelAnimationFrame(raf);
      cleanup?.();
    };
    // Once only — viewMode default is surface; the ref guards re-runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clamps + target follow the RENDERED mode so they match the visible scene.
  const preset = VIEW_PRESETS[shown];
  return (
    <>
      <Canvas
        className="world-canvas"
        // frameloop="always" (was "demand"): the scene is now a LIVING cinematic
        // vista — Earth rotates under drifting clouds, oceans shimmer at the
        // sub-solar point, the atmosphere breathes. ADR-0004's old demand-loop /
        // 0-idle-fps budget is intentionally dropped (see ADR-0004 + AGENTS.md):
        // useFrame animation is now unrestricted. The dpr cap below stays as perf
        // hygiene. Existing invalidate()/document.hidden guards remain harmless.
        frameloop="always"
        // Soft sun shadows (#104): PCFSoftShadowMap on the renderer's shadow map
        // gives the directional sun light penumbra-softened edges.
        shadows={{ type: THREE.PCFSoftShadowMap }}
        dpr={[1, 1.5]}
        // far raised to ~8000 (issue #49) so the distant Moon + Earth are in-frustum;
        // near kept at 0.1. That 0.1→8000 span is too wide for a standard depth buffer
        // at the Earth's ~4.7k distance, so logarithmicDepthBuffer is enabled below (see
        // its gl note + the logdepthbuf_* chunks in SkyBodies.tsx).
        // fov widened 42→50 (#101) for a more immersive, cinematic field — the
        // surface distance band (VIEW_PRESETS) is pulled in to hold framing.
        // position is seeded per the default view (see initialCamera) so the app
        // opens already framed on it (orbit → ORBIT_POSE, surface → worksite seat).
        camera={initialCamera}
        // While placing, a click on empty space confirms the drop; otherwise it
        // deselects a rover (the existing behaviour).
        onPointerMissed={() => (placing ? onPlaceConfirm?.() : onPick(null))}
        // antialias:false — the EffectComposer owns the framebuffers, so a
        // multisampled default backbuffer is redundant AND, on ANGLE/macOS, forces
        // a depth/stencil blitFramebuffer resolve that errors with "Read and write
        // depth stencil attachments cannot be the same image". Turning it off
        // removes the MSAA backbuffer (and that blit) entirely; the low-poly scene
        // plus soft halo bloom reads fine without canvas-level AA.
        // toneMappingExposure ≈ 1.1 (#91): a small lift on the ACESFilmic +
        // sRGB pipeline (R3F v8 defaults, kept) — gives the sunlit limb / Sun a
        // touch more presence while ACES still rolls 0 → 0, so the void stays
        // near-black. Both tone mapping + output color space remain the v8
        // defaults; only the exposure dial is set explicitly here.
        // logarithmicDepthBuffer: the orbit Earth is THREE near-coincident concentric
        // shells (surface ×1.0, cloud ×1.012, atmosphere rim ×1.03) sitting at z≈4.7k,
        // hard against the 8000 far plane. A standard hyperbolic depth buffer spends
        // almost all its precision near the 0.1 near plane, so out there the shells
        // share a depth bucket and z-fight — the cloud/rim flicker on/off every frame
        // (the "black textures appearing/disappearing"). A log depth buffer gives
        // resolvable precision across the whole 0.1–8000 range, so the shells separate
        // cleanly. The Earth/cloud/rim custom ShaderMaterials opt in via the
        // logdepthbuf_* GLSL chunks (see SkyBodies.tsx); built-in materials (Moon, Sun,
        // worksite, stars) get it automatically. The composer's SMAA + selective-bloom
        // passes don't sample scene depth, so they're unaffected. NB: a benign
        // GL_INVALID_OPERATION glBlitFramebuffer warning is logged on ANGLE/macOS (a
        // pre-existing EffectComposer depth-stencil quirk, present with or without log
        // depth); it does not affect the render.
        gl={{
          antialias: false,
          powerPreference: "high-performance",
          toneMappingExposure: 1.1,
          logarithmicDepthBuffer: true,
        }}
      >
        {/* Black background as the GRACEFUL FALLBACK (issue #50): the HDR
            Environment in <SpaceEnvironment> overrides scene.background once it
            loads, but if the .hdr is missing/fails this black backdrop remains so
            the scene never goes blank (ADR-0004 mandatory fallback). */}
        <color attach="background" args={["#000000"]} />
        <SceneContents
          snapshot={snapshot}
          selected={selected}
          onPick={onPick}
          placing={placing}
          ghost={ghost}
          placementRotation={placementRotation}
          placementInvalidReason={placementInvalidReason}
          onPlaceMove={onPlaceMove}
          onPlaceConfirm={onPlaceConfirm}
          onPlaceRotate={onPlaceRotate}
          viewMode={shown}
          onViewModeChange={onViewModeChange}
          // The RENDERED site (flips under the match-cut/descent glare), so the
          // worksite + per-site lighting/fog/scenery swap unseen behind the flash.
          activeSite={shownSite}
          onActiveSiteChange={onActiveSiteChange}
          lockedSite={lockedSite}
          statusOverride={statusOverride}
        />
        <RigBridge
          cameraRef={cameraRef}
          controlsRef={controlsRef}
          invalidateRef={invalidateRef}
        />
        {/* Suppress the canvas context menu while placing so right-drag-rotate never
            pops the OS menu (#151, Risk #1). Scoped to placing only. */}
        <PlacementGestureGuard placing={placing === true} />
        <OrbitControls
          makeDefault
          enablePan={false}
          // Disable orbit drag while placing (the placement plane owns the cursor)
          // and during the transition (the driver owns the camera).
          enableRotate={!placing && !transitioning}
          // Distance + polar clamps come from the RENDERED view preset (issue #49);
          // surface = rehearsed worksite framing, orbit = the Moon vista. Both stay
          // clamped (ADR-0004) — never a free-fly camera.
          minDistance={preset.minDistance}
          maxDistance={preset.maxDistance}
          // Clamp the vertical angle so the camera can't dip under the ground or
          // look straight down — keeps the diorama readable from any orbit.
          minPolarAngle={preset.minPolarAngle}
          maxPolarAngle={preset.maxPolarAngle}
          target={preset.target}
          // Inertial damping (#109): the controls glide to a stop instead of
          // snapping, so orbiting/zooming feels weighty. drei runs update() each
          // awake frame, so this also smooths the idle sway hand-off.
          enableDamping
          dampingFactor={0.08}
        />
        {/* Camera feel (#109): idle drift, zoom-coupled exposure, parallax. OFF
            while placing or transitioning — those own the camera. Decorative;
            never reads the snapshot. Orbit exposure is scaled down so deep space
            reads darker (the sunlit limb + celestial bloom stop blowing out). */}
        <CameraFeel active={!placing && !transitioning} onSurface={shown === "surface"} />
        {/* Orbit-open camera-arc (#158): the film's opening Scenery beat. Driven by
            the `cinematicOpen` prop (gated upstream on the cinematic arm flag); while
            running it sets `transitioning` (via runOpenTransition) so CameraFeel +
            OrbitControls stand down, then settles into ORBIT_POSE and hands the camera
            back. The SUN never moves (camera-arc, not sun-arc). Inert + non-blocking
            when the cue isn't fired — the orbit then behaves exactly as today (the
            script-sanctioned cold-hold fallback). Orbit-only; no-ops on the surface. */}
        <CinematicOpen
          active={cinematicOpen === true && shown === "orbit" && !placing}
          onSurface={shown === "surface"}
          onTransition={runOpenTransition}
          onDone={onCinematicOpenDone ?? NOOP}
        />
      </Canvas>
      {/* Glare overlay for the descent transition. A child of .stage (position:
          relative), so it fills the stage; pointer-events:none keeps clicks going
          to the canvas; opacity is driven imperatively by the rAF above. */}
      <div className="view-glare" ref={glareRef} aria-hidden="true" />
    </>
  );
}
