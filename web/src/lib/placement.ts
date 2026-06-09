
import type { BuildMode, Control, Vec2, Vec3 } from "../types/wire";

export type Envelope = { center: Vec3; size: Vec3 };

export type GhostTask = {
  id: string;
  type: string;
  pos: Vec2;
  envelope: Envelope;
};

export type CatalogTask = {
  id: string;
  type: string;
  rel: Vec2;
  envelope: Envelope;
};

export type Ghost = {
  tasks: GhostTask[];
  invalid: boolean;
};

export type ActivePlacement = {
  blueprintId: string;
  origin: Vec2 | null;
  rotation: number;
  invalidReason: string | null;
};

export function placeRel(rel: Vec2, origin: Vec2, rotation: number): Vec2 {
  const sin = Math.sin(rotation);
  const cos = Math.cos(rotation);
  const rx = rel.X * cos - rel.Y * sin;
  const ry = rel.X * sin + rel.Y * cos;
  return {
    X: Math.round((origin.X + rx) * 100) / 100,
    Y: Math.round((origin.Y + ry) * 100) / 100,
  };
}

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

export type Footprint = { cx: number; cy: number; halfX: number; halfY: number };

export function footprintOf(task: GhostTask): Footprint {
  return {
    cx: task.pos.X + task.envelope.center.X,
    cy: task.pos.Y + task.envelope.center.Y,
    halfX: Math.abs(task.envelope.size.X) / 2,
    halfY: Math.abs(task.envelope.size.Y) / 2,
  };
}

export const WORLD_BOUNDS = 150;

export const OVERLAP_PAD = 4;

function aabbOverlap(a: Footprint, b: Footprint, pad: number): boolean {
  return (
    a.cx - a.halfX - pad < b.cx + b.halfX &&
    a.cx + a.halfX + pad > b.cx - b.halfX &&
    a.cy - a.halfY - pad < b.cy + b.halfY &&
    a.cy + a.halfY + pad > b.cy - b.halfY
  );
}

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

export const ROTATE_RADIANS_PER_PIXEL = 0.008;

export function dragDeltaToRadians(dxPixels: number): number {
  return dxPixels * ROTATE_RADIANS_PER_PIXEL;
}

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
