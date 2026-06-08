// scene — the pure world→3D mapping math for the r3f renderer (Scene3D).
//
// The SAME projection drives both the 3D render AND the click raycast hit-proxy,
// so a click can never drift off the rover the user sees (ADR-0004's hardened
// click-to-kill). Kept DOM-free / three-free so it is unit-testable in vitest's
// node env, with a "no missed clicks" ethos.
//
// The server's world coordinates are domain.Vec2 with capital X/Y (no JSON tags;
// see types/wire.ts). We map that 2D worksite onto the ground plane of a 3D
// scene: world X → scene x, world Y → scene -z (so +Y world reads as "into the
// screen / away from camera", the natural top-down→isometric reading). World
// units are scaled by a FIXED real-meters→scene-units factor (Epic 04 P0), so
// every object reads at its true relative size and the framing is stable across
// snapshots — nothing here invents world state; it only positions authoritative
// snapshot points in the scene.

import type { TaskView, Vec2 } from "../types/wire";

// The ground plane is a fixed GROUND_SPAN × GROUND_SPAN square centered on the
// origin (scene units). The worksite bounding box is fit uniformly inside this
// span with a margin, so the camera framing is stable across snapshots.
export const GROUND_SPAN = 20;
export const GROUND_MARGIN = 2.5; // scene units of padding around the worksite

// ---- real-world scale (Epic 04 P0) -----------------------------------------
//
// The single fixed world→scene scale: 1 real meter = SCENE_UNITS_PER_METER scene
// units (so 1 scene unit ≈ 8.3 m). This REPLACES the old per-snapshot autoscale
// (sceneMap fit-the-bbox-into-GROUND_SPAN), which silently rescaled the whole
// worksite as the swarm spread/moved — making sizes meaningless and the framing
// jitter. With a fixed scale every object is drawn at its true relative size and
// the camera composition is stable across snapshots. Tune on screen.
export const SCENE_UNITS_PER_METER = 0.12;

// Real-world sizes (meters) of every scene object — the single source of truth
// for believable relative scale. A scene size is REAL_METERS[k] *
// SCENE_UNITS_PER_METER, so e.g. the mobile launcher (120 m · 0.12 = 14.4 u)
// towers ~60:1 over an astronaut (2 m · 0.12 = 0.24 u) — real proportions, not
// hand-tuned guesses.
export const REAL_METERS = {
  rover: 2.5,
  astronaut: 2.0,
  habitat: 6.0,
  baseStation: 4.0,
  crawler: 40,
  mobileLauncher: 120,
  gantry: 90,
  lander: 7.0,
  solarPanel: 10,
  commsMast: 12,
  commsDish: 6,
  radome: 5,
} as const;

// A SCENERY set-piece — static, snapshot-INDEPENDENT launch-infrastructure
// decoration (a crawler, launcher, gantry, lander, base station, astronaut).
// Lives here (pure data, no three) so BOTH SITE_FRAMES (below) and LaunchScenery
// share one definition: each SiteFrame carries its OWN `pieces` list, so the two
// sites can reuse the same GLBs but reposition/retint them (Epic 04 P2). The
// LaunchScenery component reads these and loads/renders the active site's pieces.
export type SetPiece = {
  key: string;
  modelRef: string;
  position: [number, number, number];
  rotation?: [number, number, number];
  // Real-world size (meters) of the model's LARGEST dimension. The NASA glTFs have
  // arbitrary native units + off-origin pivots, so a fixed scale scalar is
  // meaningless; LaunchScenery fits each to realMeters · SCENE_UNITS_PER_METER.
  realMeters: number;
  // Tint for the primitive fallback shown until/if the glTF loads.
  fallbackColor: string;
  // Primitive used for the ADR-0004 fallback. "box" (default) suits structures;
  // "capsule" gives the astronaut a human-ish silhouette.
  fallbackShape?: "box" | "capsule";
};

// The LUNAR launch complex (the original SET_PIECES). The mobile launcher
// (120 m → 14.4 u) + gantry (90 m → 10.8 u) tower over the ~2.5 m rovers; the
// crawler sits low/wide; the human-scale base station + astronaut anchor the
// scale. POSITIONS are art-directed for the literal scale (literal sizes, staged
// layout — what every NASA press render does).
export const LUNAR_SET_PIECES: SetPiece[] = [
  {
    key: "crawler",
    modelRef: "/assets/models/nasa_crawler.glb",
    position: [-22, 0, -26],
    rotation: [0, Math.PI / 5, 0],
    realMeters: REAL_METERS.crawler,
    fallbackColor: "#5a5a4e",
  },
  {
    key: "mobile-launcher",
    modelRef: "/assets/models/nasa_mobile_launcher.glb",
    position: [-9, 0, -34],
    rotation: [0, 0, 0],
    realMeters: REAL_METERS.mobileLauncher,
    fallbackColor: "#6b6b72",
  },
  {
    key: "gantry",
    modelRef: "/assets/models/nasa_gantry.glb",
    position: [12, 0, -32],
    rotation: [0, -Math.PI / 8, 0],
    realMeters: REAL_METERS.gantry,
    fallbackColor: "#7a4a3a",
  },
  {
    key: "lander",
    modelRef: "/assets/models/nasa_lunar_module.glb",
    position: [22, 0, -22],
    rotation: [0, -Math.PI / 4, 0],
    realMeters: REAL_METERS.lander,
    fallbackColor: "#b8a070",
  },
  {
    key: "base-station",
    modelRef: "/assets/models/base-station.glb",
    position: [4, 0, -6],
    rotation: [0, Math.PI / 6, 0],
    realMeters: REAL_METERS.baseStation,
    fallbackColor: "#8c8c84",
  },
];

// The SHACKLETON (lunar south pole) outpost. UNLIKE the lunar LAUNCH complex
// (crawler / mobile launcher / gantry / lander), this is a DISTINCT set of
// structures — a permanent research + ISRU (water-ice) base nestled on the carved
// crater FLOOR (every piece inside CRATER_FLOOR_RADIUS so it sits in the bowl, not
// on the rim): two NASA habitat demonstration modules, a science radome, an ISRU
// processing plant, a comms dish aimed at Earth, a rim-edge solar array, and an
// astronaut for scale. Cooled fallback tints for the dim pole light. All models are
// already-licensed GLBs from the catalog (see public/assets/CREDITS.md); none are
// shared with the lunar set, so the two sites render genuinely different hardware.
export const SHACKLETON_SET_PIECES: SetPiece[] = [
  {
    key: "shk-habitat-1",
    modelRef: "/assets/models/habitat-demo-unit-1.glb",
    position: [-8, 0, -9],
    rotation: [0, Math.PI / 5, 0],
    realMeters: 22,
    fallbackColor: "#6b7280",
  },
  {
    key: "shk-habitat-2",
    modelRef: "/assets/models/habitat-demo-unit-2.glb",
    position: [-1, 0, -13],
    rotation: [0, -Math.PI / 6, 0],
    realMeters: 20,
    fallbackColor: "#646b78",
  },
  {
    key: "shk-radome",
    modelRef: "/assets/models/radome.glb",
    position: [11, 0, -9],
    rotation: [0, -Math.PI / 4, 0],
    realMeters: 14,
    fallbackColor: "#5a626e",
  },
  {
    key: "shk-isru",
    modelRef: "/assets/models/machine_generator.glb",
    position: [7, 0, 2],
    rotation: [0, Math.PI / 3, 0],
    realMeters: 12,
    fallbackColor: "#5e6672",
  },
  {
    key: "shk-comms-dish",
    modelRef: "/assets/models/comms-dish.glb",
    position: [-13, 0, 2],
    rotation: [0, Math.PI / 2.5, 0],
    realMeters: 10,
    fallbackColor: "#69707c",
  },
  {
    key: "shk-solar",
    modelRef: "/assets/models/solar-panel.glb",
    position: [12, 0, -13],
    rotation: [0, -Math.PI / 6, 0],
    realMeters: 14,
    fallbackColor: "#4f5662",
  },
  {
    key: "shk-astronaut",
    modelRef: "/assets/models/astronaut.glb",
    position: [2, 0, -5],
    rotation: [0, -Math.PI / 3, 0],
    realMeters: REAL_METERS.astronaut,
    fallbackColor: "#c8ccd4",
    fallbackShape: "capsule",
  },
];

// A per-site framing transform. The fixed scale is uniform across sites; each
// site recenters its worksite (cx,cy in world coords) onto the scene origin and
// rotates it (rot, radians) so the hero composition is art-directed per site.
// `worksiteUnitsToMeters` converts the (abstract) worksite units into meters —
// the single remaining free knob for a site's overall footprint. Per-site LIGHTING
// (sunDir/sunIntensity), terrain TINT, FOG, and the SCENERY `pieces` list ride
// here too (Epic 04 P2) so SceneContents reads everything for the active site from
// one record.
export type SiteFrame = {
  cx: number;
  cy: number;
  rot: number;
  worksiteUnitsToMeters: number;
  // Off-screen directional sun direction for the SURFACE view (the surface uses a
  // directional light only; the orbit Sun *body* stays at the global SUN_POSITION).
  // Lunar: high key light. Shackleton: low grazing pole sun (small Y vs large X|Z).
  sunDir: [number, number, number];
  // Surface key-light intensity. Shackleton reads dimmer (the grazing pole sun).
  sunIntensity: number;
  // Base color tint of the regolith terrain for this site.
  terrainTint: string;
  // Surface horizon fog: [color, near, far].
  fog: [string, number, number];
  // The static scenery set-pieces rendered at this site.
  pieces: SetPiece[];
};

// The full per-site framing + lighting + scenery table (Epic 04 P2). `siteMap`
// takes one of these to project that site's worksite; SceneContents reads
// lighting/tint/fog/pieces from the active site's entry. worksiteUnitsToMeters is
// kept at the tuned 2.5 (from #134's DEFAULT_SITE_FRAME), NOT the plan's stale 1.0.
export const SITE_FRAMES: Record<"lunar" | "shackleton", SiteFrame> = {
  lunar: {
    cx: 0,
    cy: 0,
    rot: 0,
    worksiteUnitsToMeters: 2.5,
    // WS-5 (#172): lift the lunar sun elevation (y 1265 → 2600, ~10° → ~21°) so the
    // flat regolith actually CATCHES the key instead of being grazed to mid-grey,
    // while still raking enough to throw dramatic shadows. Azimuth (x,z) unchanged so
    // the Earth-framing / cinematic sun bearing is preserved.
    sunDir: [2300, 2600, -6490],
    // A brighter, harder lunar key (1.9 → 3.6). Real lunar sun is brutal — blinding
    // sunlit regolith against near-black shadow (no atmosphere to scatter fill).
    // Paired with crushed ambient/hemisphere fill below for high contrast.
    // Shackleton keeps its dimmer grazing pole key (1.7).
    sunIntensity: 3.6,
    // WS-4 (#170): neutral grey, NOT warm brown. The old #9a948c (r>g>b) tinted the
    // regolith map toward dirt/Mars — the single biggest "this looks like dirt" tell.
    // Real lunar regolith is a near-neutral, faintly cool grey; this multiplies the
    // Moon 01 diffuse to that. Brightness ~unchanged so the lighting pass reads the same.
    terrainTint: "#969798",
    fog: ["#000000", 180, 680],
    pieces: LUNAR_SET_PIECES,
  },
  shackleton: {
    cx: 400,
    cy: 0,
    rot: 0.3,
    worksiteUnitsToMeters: 2.5,
    sunDir: [6490, 90, -2300],
    sunIntensity: 1.7,
    // Shackleton keeps a DISTINCT identity from the lunar hero site (#170): darker
    // (deep polar shadow) and cooler (the old #6f6a66 read faintly warm) — a cold
    // blue-grey pole crater, set apart from the neutral lunar plain above.
    terrainTint: "#64676d",
    fog: ["#05060a", 120, 520],
    pieces: SHACKLETON_SET_PIECES,
  },
};

// The default (single-site) frame — points at the lunar site for back-compat (the
// pre-P2 single-site renderer + tests use this). The dome ring radii (24/46) are
// ABSTRACT worksite units, not meters (see worksiteUnitsToMeters), read as ~2.5 m
// each so the worksite renders at a readable footprint while the literally-sized
// launch complex still towers over it.
export const DEFAULT_SITE_FRAME: SiteFrame = SITE_FRAMES.lunar;

// The Moon globe's berth + radius (orbit-view hero). Lives here, not in the
// SkyBodies component, so BOTH the renderer (SkyBodies) and the camera framing
// (Scene3D's orbit preset + descent transition) import one source of truth — the
// camera and the globe can never drift apart. See SkyBodies.tsx / Scene3D.tsx.
export const MOON_RADIUS = 90;
export const MOON_POSITION: [number, number, number] = [0, 60, -520];

// The Sun — the scene's single light emitter. Lives here so BOTH the renderer
// (SkyBodies' SunBody mesh) and the lighting (Scene3D's directionalLight) share
// one position: the light literally comes FROM the visible sun. Placed very far
// (a nod to the real ~1 AU distance — vastly farther than the Moon at z=-520),
// well inside the 8000 far-plane. It sits in the FORWARD sky (−z, upper-right) so
// it is actually VISIBLE in the orbit vista; because it is then beyond the Moon,
// the Moon reads back-lit (a sunlit crescent) — true space lighting — with the
// dark side filled by EARTHSHINE (see EARTH_POSITION + Scene3D's earthshine
// light). The sun reads WHITE (sunlight in vacuum has no atmosphere to redden it)
// — see SunBody's white emissive.
export const SUN_POSITION: [number, number, number] = [2300, 1265, -6490];

// ORBIT-ONLY sun direction (Wave 4 "living orbit"). The surface worksite sits on the
// Moon's camera-facing near side and is lit by SUN_POSITION above; the ORBIT vista,
// by contrast, wants the NASA SVS #14992 look — a near-DARK Moon far side with a thin
// sunlit crescent. Those two needs conflict on a single sun (back-lighting the orbit
// Moon would plunge the worksite into lunar night), so the orbit view DECOUPLES its
// sun here. Orbit and surface are never co-visible, so this is invisible seam-wise.
// Aimed so the sub-solar point faces AWAY from the orbit camera (camera berths at
// MOON + ~[264,85,26]): Moon→Sun·Moon→Camera ≈ −0.31 → a crescent on the lower-left
// limb, with the flare itself ~69° off-axis (off-frame, like the reference). Earth
// (off to the camera-left) then reads as a clean day/night terminator. Kept far
// (|pos| ≈ 6.8k, inside the 8000 far-plane) with sun.y > 0 so it still grazes high.
// TUNED BY EYE against SVS #14992 — see docs/02-realistic-3d-world/space-view-realism.md.
// SIDE-LIT (Wave 4.1): the prior value sat almost directly BEHIND the Moon
// (Moon→Sun·Moon→Camera ≈ −0.75 → ~87% of the near face dark), so the settled orbit
// view showed a near-black disc that read as "disappearing" against the black void,
// and the fly-in loomed as a dark sphere before the glare. The reference is actually a
// near-far-side Moon lit ACROSS its face with the terminator (the dark side) sweeping
// in from one limb — a clear smooth light→dark transition, NOT a near-total eclipse.
// Re-aimed so Moon→Sun·Moon→Camera ≈ +0.06 — a near-HALF-lit Moon: the right
// hemisphere (toward Earth/the sun) is directly sunlit, the LEFT hemisphere falls
// into shadow, and a dramatic terminator sweeps down the middle. This is the SVS
// #14992 read: NOT a flat fully-lit globe (which looked plastic) and NOT a near-black
// disc that vanished into the void (the prior −0.75), but a moody half-Moon whose
// SHADOW side still reads — its craters picked out by EARTHSHINE (see Scene3D's
// earthshine point light, lifted for exactly this dark-side detail). The dark side
// sits on the LEFT (the user's ask). Kept far (|pos| ≈ 7.0k, inside the 8000
// far-plane) with sun.y > 0 so it grazes from slightly above; the flare lands
// off-frame to the right, past the bright limb.
export const ORBIT_SUN_POSITION: [number, number, number] = [806, 795, -6929];
// Modeled radius — small, so the far Sun (|pos| ≈ 7k, near the 8000 far-plane)
// reads as a brilliant DISTANT disc (~1.3° across) rather than a near wall of
// light. Its presence comes from the additive glow + radiating light-rays around
// it (see SunBody, which scale with this radius), not disc size.
export const SUN_RADIUS = 80;

// Earth — a distant decorative body, sized PROPORTIONALLY to the Moon (real
// diameter ratio ≈ 3.67×) and hung BEYOND the Moon's upper-right limb so the orbit
// vista matches the NASA reference (SVS #14992): the close grey Moon as the hero,
// Earth a smaller marble (~1/3 the Moon's apparent diameter) just off its limb,
// the Milky-Way band diagonal behind both. Positioned so it falls inside the orbit
// camera frustum (camera ≈ (264,145,-494) looking at the Moon, fov 42, 16:9): at
// |cam→Earth| ≈ 3015 the 330-radius disc subtends ≈ 12.6° (vs the Moon's ≈ 37.7°),
// landing ~15° right / ~17° up of the Moon — comfortably in frame. (The prior
// [-220,640,-3050] sat ~78° off the Moon, fully outside the frustum → Earth was
// never visible.) Lives here (not in SkyBodies) so Scene3D's EARTHSHINE light can
// share Earth's position — the blue fill on the Moon's night side comes FROM the
// visible Earth, the way reflected earthlight really does.
export const EARTH_RADIUS = Math.round(MOON_RADIUS * 3.67); // ≈ 330, proportional to the Moon
// Pushed FARTHER (|cam→Earth| ≈ 4.7k, up from ~3.0k) so Earth subtends ~4° — a small
// marble that tucks cleanly into the ~10° gap between the Moon's right limb (the hero
// fills ~28°) and the frame edge, with margin to spare for the idle camera drift. The
// prior berth made Earth ~6° across, so its disc both clipped the right edge AND grazed
// the Moon's limb at drift extremes (the user's framing bug). Re-aimed ~19° right of the
// Moon and held near the Moon's vertical centre (y kept ≈ −460 so the SURFACE-view Earth,
// which shares this berth, stays where it was in that sky). Reference: SVS #14992 — Earth
// a clean day/night marble just off the Moon's sunlit limb.
export const EARTH_POSITION: [number, number, number] = [-3993, -460, -2427];

// ---- lat/lon → globe point (Epic 04 P3, orbit site markers) ----------------
//
// Maps a real lunar latitude/longitude onto the orbit Moon globe — a sphere of
// MOON_RADIUS centred at MOON_POSITION — returning the world-space surface point
// AND the outward surface normal there (so a marker can be seated flat on the
// globe, oriented to the local up). Kept three-free (plain vectors) so it stays
// unit-testable in node and shares one source of truth with the renderer.
//
// Parameterisation: latitude φ measured from the equator (+90 = north pole, +y),
// longitude λ around the equator. A GLOBAL longitude offset (MARKER_LON_OFFSET)
// rotates the whole lat/lon grid about the polar (y) axis so the two site markers
// can be swung onto the camera-facing AND sunlit near hemisphere of the orbit
// globe (the #131 lit-hemisphere requirement) and aligned to the Moon texture
// seam — tuned by eye in the visual E2E.
//
// At offset 0 the (lat 0, lon 0) point sits on +z (toward the orbit camera-ish
// near face). The offset below was tuned so both sites read on the lit near face
// under ORBIT_SUN_POSITION for the default orbit camera. (The Shackleton MARKER
// is art-directed to a southern — not literal-pole — seat; see SkyBodies.tsx,
// since the literal south pole is back-facing AND unlit on the orbit globe.)
export const MARKER_LON_OFFSET = 108; // degrees, tuned by eye (see SkyBodies P3)

// The outward surface normal at (lat, lon) — a unit vector. Exposed alongside the
// point so the marker math (quaternion to the surface up) need not recompute it.
export function latLonToGlobeNormal(
  lat: number,
  lon: number,
  lonOffset = MARKER_LON_OFFSET,
): [number, number, number] {
  const DEG = Math.PI / 180;
  const phi = lat * DEG; // from equator; +90 = north pole
  const lambda = (lon + lonOffset) * DEG;
  const cosPhi = Math.cos(phi);
  // x/z on the equatorial circle, y up the polar axis. At lambda=0 → +z.
  const nx = cosPhi * Math.sin(lambda);
  const ny = Math.sin(phi);
  const nz = cosPhi * Math.cos(lambda);
  return [nx, ny, nz];
}

// The world-space surface point at (lat, lon) on the orbit Moon globe.
export function latLonToGlobePoint(
  lat: number,
  lon: number,
  lonOffset = MARKER_LON_OFFSET,
): [number, number, number] {
  const [nx, ny, nz] = latLonToGlobeNormal(lat, lon, lonOffset);
  return [
    MOON_POSITION[0] + nx * MOON_RADIUS,
    MOON_POSITION[1] + ny * MOON_RADIUS,
    MOON_POSITION[2] + nz * MOON_RADIUS,
  ];
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// A 3D point on/above the ground plane (y is "up").
export type ScenePoint = { x: number; y: number; z: number };

// Bounding box over all worksite points. A zero-size span (single point /
// colinear worksite) is nudged out by 1 world unit so a consumer never divides by
// zero — a guard kept local to avoid coupling.
// NB (Epic 04 P0): this NO LONGER drives the scene scale (the scale is now fixed);
// it is retained, exported, for tests and any bbox consumer.
export function computeBounds(points: Vec2[]): Bounds {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.X < minX) minX = p.X;
    if (p.Y < minY) minY = p.Y;
    if (p.X > maxX) maxX = p.X;
    if (p.Y > maxY) maxY = p.Y;
  }
  if (maxX - minX < 1) {
    minX -= 1;
    maxX += 1;
  }
  if (maxY - minY < 1) {
    minY -= 1;
    maxY += 1;
  }
  return { minX, minY, maxX, maxY };
}

// A world→scene mapper. `at(pos, height)` projects a world Vec2 onto the ground
// plane (height = y, the elevation above the ground, default 0). `scale` is the
// fixed world→scene factor (SCENE_UNITS_PER_METER · worksiteUnitsToMeters),
// exposed so callers can size worksite-relative meshes consistently (e.g. the
// placement-ghost footprint in scene units).
export type SceneMap = {
  scale: number;
  at: (pos: Vec2, height?: number) => ScenePoint;
  // invert maps a ground-plane scene point (x, z) BACK to world coords — the
  // exact inverse of `at`. Used by drag-to-place (bh-05) to turn a raycast hit on
  // the ground into the world origin the user is dropping a Blueprint on, so the
  // ghost and the emitted placeBlueprint origin share the same projection.
  invert: (x: number, z: number) => Vec2;
};

// Build the world→scene mapper from a per-site framing transform. The scale is
// FIXED (SCENE_UNITS_PER_METER · worksiteUnitsToMeters), NOT fit-to-bbox — so
// every object renders at its true relative size and the framing never jitters as
// the swarm moves (Epic 04 P0). The frame recenters the site's worksite onto the
// scene origin (cx,cy) and rotates it (rot). World X maps to scene +x, world Y to
// scene -z (so +Y heads away from a camera on the +z side). This is the single
// source of truth used for BOTH rendering and the raycast hit-proxy — they can
// never disagree, and `at`/`invert` stay exact inverses (drag-to-place + the
// hit-proxy depend on it). It reads ONLY the framing fields, so it accepts any
// object carrying them (a full SiteFrame, or a bare framing literal in tests).
export function siteMap(
  site: Pick<SiteFrame, "cx" | "cy" | "rot" | "worksiteUnitsToMeters">,
): SceneMap {
  const s = SCENE_UNITS_PER_METER * site.worksiteUnitsToMeters;
  const { cx, cy, rot } = site;
  const cos = Math.cos(rot),
    sin = Math.sin(rot);
  return {
    scale: s,
    at: (p: Vec2, height = 0): ScenePoint => {
      const dx = p.X - cx,
        dy = p.Y - cy;
      const rx = dx * cos - dy * sin,
        ry = dx * sin + dy * cos;
      return { x: rx * s, y: height, z: -ry * s };
    },
    invert: (x: number, z: number): Vec2 => {
      const rx = x / s,
        ry = -z / s;
      const dx = rx * cos + ry * sin,
        dy = -rx * sin + ry * cos;
      return { X: dx + cx, Y: dy + cy };
    },
  };
}

// ---- Shackleton crater profile (Epic 04 follow-up) -------------------------
//
// A stylized, art-directed crater carved into the SHACKLETON terrain so the pole
// outpost reads as a genuinely distinct PLACE (nestled on a shadowed crater floor
// under a sunlit rim) rather than the lunar worksite merely retinted. Reference
// look: NASA SVS 4716 — a ~21 km × 4 km bowl with a permanently shadowed floor and
// rim points caught by the grazing pole sun. We do NOT model that literal scale (a
// 21 km bowl would be ~2520 scene units; the whole plane is 700); this is an
// art-directed bowl, consistent with the already art-directed framing.
//
// CRUCIAL: the floor stays at scene-y ≈ 0, with the rim raised AROUND it. Every
// worksite object (rover/task/scenery) is seated at y=0 via siteMap (height=0), so
// keeping the floor at 0 means NOTHING in the worksite has to move — only the
// surrounding terrain rises into a rim. The floor radius is chosen to sit OUTSIDE
// the farthest Shackleton set-piece (the crawler at scene-radius ≈ 40) so the whole
// outpost rests on the flat floor and the rim crests beyond it.
// Scaled to the WORKSITE, not to a literal 21 km bowl: at 0.12 units/m the outpost
// structures are only ~1 unit each, so a giant crater would dwarf them into specks.
// The floor holds the tight worksite + ringed structures (all within FLOOR_RADIUS),
// the rim cradles it just beyond, and the bowl is shallow enough that the base and
// its containing rim both read in one frame — "nestled in a crater".
export const CRATER_FLOOR_RADIUS = 18; // flat floor (worksite + structures sit here, y≈0)
export const CRATER_RIM_RADIUS = 34; // rim crest (the peak of the bowl wall)
export const CRATER_OUTER_RADIUS = 70; // crest eases back to the open plain by here
export const CRATER_RIM_HEIGHT = 7; // crest height above the floor (the sunlit ridge)

// Clamped smoothstep (a→b), C1-continuous, used to shape the crater wall/flank so
// the bowl has no hard creases. Kept local (scene.ts is three-free + node-testable).
function smoothstep01(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The crater's radial elevation delta (scene-y) at scene-radius r (units) from the
// worksite origin: a flat floor (0) out to CRATER_FLOOR_RADIUS, an inner wall that
// rises to CRATER_RIM_HEIGHT at the rim crest, then an outer flank that eases the
// crest back down to the surrounding plain (0). ADDED on top of the terrain's
// procedural noise displacement by LunarTerrain (Shackleton only). Pure ⇒ unit-
// tested in scene.test.ts.
export function craterProfile(r: number): number {
  if (r <= CRATER_FLOOR_RADIUS) return 0;
  if (r <= CRATER_RIM_RADIUS)
    return CRATER_RIM_HEIGHT * smoothstep01(CRATER_FLOOR_RADIUS, CRATER_RIM_RADIUS, r);
  if (r <= CRATER_OUTER_RADIUS)
    return CRATER_RIM_HEIGHT * (1 - smoothstep01(CRATER_RIM_RADIUS, CRATER_OUTER_RADIUS, r));
  return 0;
}

// ---- habitat dome: rising-by-completion ordering ---------------------------

// Construction tiers, lowest (built first) to highest. The dome rises
// block-by-block as tasks COMPLETE: foundations form the base ring, walls the
// mid ring, and the dome task the cap. Ordering is derived from the task `type`
// string (CONTEXT.md vocabulary) so it is a pure function of the snapshot, never
// a client-side timer. Unknown types sort last (treated as cap-level detail).
export type BuildTier = "foundation" | "wall" | "dome" | "other";

export function tierOf(type: string): BuildTier {
  const t = type.toLowerCase();
  if (t.includes("foundation")) return "foundation";
  if (t.includes("wall")) return "wall";
  if (t.includes("dome") || t.includes("cap") || t.includes("roof")) return "dome";
  return "other";
}

// The scene-y elevation (height above ground) at which a tier's block sits, so
// completed foundations sit on the ground, walls stack above them, and the cap
// crowns the structure. Pure layout — no world state invented.
export function tierHeight(tier: BuildTier): number {
  switch (tier) {
    case "foundation":
      return 0.15;
    case "wall":
      return 0.9;
    case "dome":
      return 1.9;
    default:
      return 1.9;
  }
}

// Whether a task's block should be rendered as "built" (solid) vs. "ghost"
// (a faint placeholder of the structure-to-be). The dome rises ONLY as tasks
// reach DONE — a pure read of authoritative status, so the structure can never
// claim progress the World Model hasn't recorded.
export function isBuilt(task: Pick<TaskView, "status">): boolean {
  return task.status === "DONE";
}
