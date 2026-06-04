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
