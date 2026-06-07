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
// units are scaled uniformly so the whole worksite fits a fixed ground span,
// regardless of how spread out the rovers/tasks are — nothing here invents world
// state; it only positions authoritative snapshot points in the scene.

import type { TaskView, Vec2 } from "../types/wire";

// The ground plane is a fixed GROUND_SPAN × GROUND_SPAN square centered on the
// origin (scene units). The worksite bounding box is fit uniformly inside this
// span with a margin, so the camera framing is stable across snapshots.
export const GROUND_SPAN = 20;
export const GROUND_MARGIN = 2.5; // scene units of padding around the worksite

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
// Pushed further BEHIND the Moon (from the orbit camera at MOON+[265,145,-512]):
// Moon→Sun·Moon→Camera ≈ −0.70 → only ~15% of the near face is sunlit, so the Moon
// reads as a dramatic dark disc with a thin warm crescent on the lower-left limb
// (the flare sits just off that limb, ~off-frame), exactly the reference phase.
export const ORBIT_SUN_POSITION: [number, number, number] = [-4200, -600, -5000];
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
export const EARTH_POSITION: [number, number, number] = [-2340, -473, -1882];

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// A 3D point on/above the ground plane (y is "up").
export type ScenePoint = { x: number; y: number; z: number };

// Bounding box over all worksite points. A zero-size span (single point /
// colinear worksite) is nudged out by 1 world unit so the fit never divides by
// zero — identical guard to hitTest.computeBounds, kept local to avoid coupling.
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
// uniform world→scene factor, exposed so callers can size meshes consistently
// (e.g. a rover's hit-proxy in scene units).
export type SceneMap = {
  scale: number;
  at: (pos: Vec2, height?: number) => ScenePoint;
  // invert maps a ground-plane scene point (x, z) BACK to world coords — the
  // exact inverse of `at`. Used by drag-to-place (bh-05) to turn a raycast hit on
  // the ground into the world origin the user is dropping a Blueprint on, so the
  // ghost and the emitted placeBlueprint origin share the same projection.
  invert: (x: number, z: number) => Vec2;
};

// Build the world→scene mapper from ALL worksite points (rovers + tasks), so the
// framing is shared and stable. Uniform scale fits the worksite bounding box
// inside (GROUND_SPAN - 2*GROUND_MARGIN); the box is centered on the origin.
// World X maps to scene +x; world Y maps to scene -z (so +Y heads away from a
// camera placed on the +z side). This is the single source of truth used for
// BOTH rendering and the raycast hit-proxy — they can never disagree.
export function sceneMap(rovers: Vec2[], tasks: Vec2[]): SceneMap {
  const b = computeBounds([...rovers, ...tasks]);
  const spanX = b.maxX - b.minX;
  const spanY = b.maxY - b.minY;
  const usable = GROUND_SPAN - GROUND_MARGIN * 2;
  const scale = Math.min(usable / spanX, usable / spanY);

  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  return {
    scale,
    at: (pos: Vec2, height = 0): ScenePoint => ({
      x: (pos.X - cx) * scale,
      y: height,
      z: -(pos.Y - cy) * scale,
    }),
    invert: (x: number, z: number): Vec2 => ({
      X: x / scale + cx,
      Y: -z / scale + cy,
    }),
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
