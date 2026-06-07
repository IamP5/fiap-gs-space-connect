// scene — the pure world→3D mapping math for the r3f renderer (Scene3D).
//
// The SAME projection drives both the 3D render AND the click raycast hit-proxy,
// so a click can never drift off the rover the user sees (ADR-0004's hardened
// click-to-kill). Kept DOM-free / three-free so it is unit-testable in vitest's
// node env, mirroring hitTest.ts's "no missed clicks" ethos for the 2D canvas.
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

// A per-site framing transform. The fixed scale is uniform across sites; each
// site recenters its worksite (cx,cy in world coords) onto the scene origin and
// rotates it (rot, radians) so the hero composition is art-directed per site.
// `worksiteUnitsToMeters` converts the (abstract) worksite units into meters —
// the single remaining free knob for a site's overall footprint (start 1.0).
export type SiteFrame = {
  cx: number;
  cy: number;
  rot: number;
  worksiteUnitsToMeters: number;
};

// The default (single-site) frame for P0: worksite origin at the scene origin, no
// rotation. The dome ring radii (24/46) are ABSTRACT worksite units, not meters
// (see SiteFrame.worksiteUnitsToMeters), so we read them as ~2.5 m each — a ~45 m
// construction site — which renders the worksite at a readable ~5–6 scene-unit
// footprint while the literally-sized launch complex (120 m launcher → 14.4 u)
// still towers believably over it. This is the single free framing knob (tune on
// screen). The full per-site SITE_FRAMES table is a later slice — P0 only needs
// siteMap to exist and take a frame.
export const DEFAULT_SITE_FRAME: SiteFrame = {
  cx: 0,
  cy: 0,
  rot: 0,
  worksiteUnitsToMeters: 2.5,
};

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

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// A 3D point on/above the ground plane (y is "up").
export type ScenePoint = { x: number; y: number; z: number };

// Bounding box over all worksite points. A zero-size span (single point /
// colinear worksite) is nudged out by 1 world unit so a consumer never divides by
// zero — identical guard to hitTest.computeBounds, kept local to avoid coupling.
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
// hit-proxy depend on it).
export function siteMap(site: SiteFrame): SceneMap {
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
