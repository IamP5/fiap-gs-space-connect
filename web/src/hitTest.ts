// hitTest — the pure world→screen projection plus a click hit-test.
//
// The exact same projection drives the canvas draw (WorldCanvas) AND the click
// hit-test, so a click always lands on the rover the user sees. Keeping it here
// as pure math (no DOM, no canvas) means it is unit-testable and the "no missed
// clicks" guarantee can be asserted in vitest.

import type { Snapshot, Vec2 } from "./types";

// Layout constants shared with WorldCanvas. ROVER_R is the drawn rover radius;
// the click pick radius is intentionally more forgiving (see pickRover).
export const PADDING = 56;
export const ROVER_R = 11;

export type Projector = {
  tx: (p: Vec2) => number;
  ty: (p: Vec2) => number;
};

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// Bounding box over all worksite points. Avoids a zero-size span (single point
// / colinear worksite) by nudging the bounds out by 1 world unit.
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

// Build a world→screen projector. Reproduces WorldCanvas's fit math exactly:
// uniform scale inside PADDING, centered, with Y flipped so +Y points up.
// `cssW`/`cssH` are CSS pixels (the canvas is pre-scaled by devicePixelRatio
// at draw time, so the projection itself always works in CSS px).
export function project(rovers: Vec2[], tasks: Vec2[], cssW: number, cssH: number): Projector {
  const b = computeBounds([...tasks, ...rovers]);

  const spanX = b.maxX - b.minX;
  const spanY = b.maxY - b.minY;
  const usableW = cssW - PADDING * 2;
  const usableH = cssH - PADDING * 2;
  const scale = Math.min(usableW / spanX, usableH / spanY);
  const offX = PADDING + (usableW - spanX * scale) / 2;
  const offY = PADDING + (usableH - spanY * scale) / 2;

  return {
    tx: (p: Vec2) => offX + (p.X - b.minX) * scale,
    ty: (p: Vec2) => offY + (b.maxY - p.Y) * scale,
  };
}

// Nearest rover whose projected screen position is within `radius` CSS px of
// (px, py); null if none. Ties resolve to the nearest by distance. The default
// radius is deliberately generous (ROVER_R + 12 ≈ 23px) so clicks are forgiving.
export function pickRover(
  snapshot: Snapshot,
  px: number,
  py: number,
  cssW: number,
  cssH: number,
  radius: number = ROVER_R + 12,
): string | null {
  if (cssW <= 0 || cssH <= 0) return null;

  const proj = project(
    snapshot.rovers.map((r) => r.pos),
    snapshot.tasks.map((t) => t.pos),
    cssW,
    cssH,
  );

  const r2 = radius * radius;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const r of snapshot.rovers) {
    const dx = proj.tx(r.pos) - px;
    const dy = proj.ty(r.pos) - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && d2 < bestDist) {
      bestDist = d2;
      bestId = r.id;
    }
  }

  return bestId;
}
