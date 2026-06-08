// placement — the pure math for drag-to-place (bh-05).
//
// A Blueprint is dragged into the world; a ghost preview shows each Task's Build
// envelope as a ground footprint at an origin + rotation the user sets, before
// confirming a `placeBlueprint` control. This module is the PURE transform behind
// that preview (no three, no DOM), so it is unit-testable in vitest's node env
// and shared by the Scene3D ghost: the same math that previews a placement is
// what the coordinator re-derives server-side, so the ghost can't drift from the
// injected tasks.
//
// World coordinates are domain.Vec2 with capital X/Y (no JSON tags; see
// types/wire.ts). Rotation is radians about the origin, matching the Go
// blueprint.Place transform exactly: rx = x·cos − y·sin, ry = x·sin + y·cos.

import type { BuildMode, Control, Vec2, Vec3 } from "../types/wire";

// An Envelope mirrors Go's blueprint.Envelope: a center offset (relative to the
// task position) and full size (extent) in worksite units. Only the XY footprint
// is used for the ground preview.
export type Envelope = { center: Vec3; size: Vec3 };

// One ghost task: its absolute worksite position and its envelope, ready to
// project to the ground plane.
export type GhostTask = {
  id: string;
  type: string;
  pos: Vec2; // absolute worksite position (after rotate+translate)
  envelope: Envelope;
};

// A blueprint task as authored in the web catalog: a relative position and an
// envelope (no deps needed for the visual ghost).
export type CatalogTask = {
  id: string;
  type: string;
  rel: Vec2; // position relative to the blueprint origin
  envelope: Envelope;
};

// Ghost is the transient preview the scene draws while placing: the instantiated
// tasks + whether the current spot is invalid (so the scene can tint it red).
export type Ghost = {
  tasks: GhostTask[];
  invalid: boolean;
};

// ActivePlacement is the live drag-to-place interaction shared between App (which
// owns it) and Scene3D (which draws the ghost + raycasts the origin). `origin` is
// null until the cursor first hits the ground; `invalidReason` is the client
// mirror of the server gate (null = valid).
export type ActivePlacement = {
  blueprintId: string;
  origin: Vec2 | null;
  rotation: number; // radians
  invalidReason: string | null;
};

// placeRel rotates a relative worksite offset about the origin then translates it
// onto the origin — the EXACT transform Go's blueprint.Place applies, so a web
// ghost and the server-injected task land on the same spot. Rotation is radians.
export function placeRel(rel: Vec2, origin: Vec2, rotation: number): Vec2 {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  const rx = rel.X * cos - rel.Y * sin;
  const ry = rel.X * sin + rel.Y * cos;
  // Round to 0.01 to match the Go side's byte-stable placement.
  return {
    X: Math.round((origin.X + rx) * 100) / 100,
    Y: Math.round((origin.Y + ry) * 100) / 100,
  };
}

// ghostTasks instantiates a catalog Blueprint's tasks at an origin + rotation,
// returning each task's absolute position + envelope for the ground preview.
export function ghostTasks(
  tasks: CatalogTask[],
  origin: Vec2,
  rotation: number,
): GhostTask[] {
  return tasks.map((t) => ({
    id: t.id,
    type: t.type,
    pos: placeRel(t.rel, origin, rotation),
    envelope: t.envelope,
  }));
}

// A 2D footprint rectangle in worksite units: the axis-aligned XY extent of a
// task's envelope, centred on the task position (+ the envelope's XY center
// offset). Half-extents are returned so a renderer can size a ground quad.
export type Footprint = { cx: number; cy: number; halfX: number; halfY: number };

// footprintOf projects a task's envelope to its ground footprint, centred on its
// worksite position. This is the envelope→footprint mapping the ghost draws: the
// quad's half-extents come from the envelope size (XY), its center from the task
// position plus the envelope's XY center offset.
export function footprintOf(task: GhostTask): Footprint {
  return {
    cx: task.pos.X + task.envelope.center.X,
    cy: task.pos.Y + task.envelope.center.Y,
    halfX: Math.abs(task.envelope.size.X) / 2,
    halfY: Math.abs(task.envelope.size.Y) / 2,
  };
}

// WORLD_BOUNDS is the client mirror of the coordinator's default build square
// half-extent (internal/coordinator.defaultWorldBounds). The ghost previews
// validity against the SAME rule the server enforces, so the user sees a
// placement turn invalid (and confirm disabled) before they emit a control that
// the coordinator would reject — the UI feedback for "invalid placement is
// rejected" without inventing a server-side rejection channel.
export const WORLD_BOUNDS = 150;

// OVERLAP_PAD mirrors the coordinator's overlapPad: structures that merely touch
// are treated as overlapping, so the preview matches the server's no-overlap gate.
export const OVERLAP_PAD = 4;

// aabbOverlap reports whether two padded axis-aligned footprints intersect.
function aabbOverlap(a: Footprint, b: Footprint, pad: number): boolean {
  return (
    a.cx - a.halfX - pad < b.cx + b.halfX &&
    a.cx + a.halfX + pad > b.cx - b.halfX &&
    a.cy - a.halfY - pad < b.cy + b.halfY &&
    a.cy + a.halfY + pad > b.cy - b.halfY
  );
}

// placementValid mirrors the coordinator's validatePlacement (bounds + no-overlap)
// on the CLIENT so the ghost can show validity live and confirm can be gated. It
// returns a reason string when invalid (for UI feedback), or null when valid.
// `obstacles` are the existing structures' footprints (derived from the snapshot's
// task positions); terrain is flat (always valid) like the server.
export function placementValid(
  ghosts: GhostTask[],
  obstacles: Footprint[],
  bounds = WORLD_BOUNDS,
): string | null {
  for (const g of ghosts) {
    const f = footprintOf(g);
    if (
      f.cx - f.halfX < -bounds ||
      f.cx + f.halfX > bounds ||
      f.cy - f.halfY < -bounds ||
      f.cy + f.halfY > bounds
    ) {
      return `${g.id} is out of bounds`;
    }
    for (const o of obstacles) {
      if (aabbOverlap(f, o, OVERLAP_PAD)) return `${g.id} overlaps an existing structure`;
    }
  }
  return null;
}

// ROTATE_RADIANS_PER_PIXEL maps a horizontal pixel drag to a rotation rate for the
// in-scene right-drag-rotate gesture (Epic 06 P1, #151). Tuned so a full screen-width
// drag (~800px) sweeps a little over a full turn — fine enough for precise aiming but
// quick enough to spin a blueprint with a short flick.
export const ROTATE_RADIANS_PER_PIXEL = 0.008;

// dragDeltaToRadians converts a horizontal pointer-drag delta (in pixels, dragged-right
// = positive) into a rotation delta in radians, to add to a base rotation. Pure so the
// gesture maths is unit-testable and the scene just wires the live drag to it. Dragging
// right rotates clockwise (positive radians), matching the on-screen footprint sweep.
export function dragDeltaToRadians(dxPixels: number): number {
  return dxPixels * ROTATE_RADIANS_PER_PIXEL;
}

// placeBlueprintControl builds the placeBlueprint control frame the dashboard
// sends on confirm (bh-05 + bh-08c). It threads the per-placement build MODE
// alongside the blueprint id, origin and rotation, mirroring wire.go's Control
// (snake_case json). It is the single source of the frame's shape, so the App
// dispatcher and the tests can't drift: an omitted/replay mode keeps the placement
// on the deterministic replay path (back-compat), and "live" opts THIS placement
// into the Build harness.
export function placeBlueprintControl(
  blueprintId: string,
  origin: Vec2,
  rotation: number,
  mode: BuildMode,
): Control {
  return {
    cmd: "placeBlueprint",
    blueprint_id: blueprintId,
    origin,
    rotation,
    mode,
  };
}
