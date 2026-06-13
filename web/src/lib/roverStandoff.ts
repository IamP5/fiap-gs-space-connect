
import type { Vec2 } from "../types/wire";

export const BUILD_STANDOFF = 6;

export function roverStandoffPos(
  roverPos: Vec2,
  blockPositions: readonly Vec2[],
  standoff: number = BUILD_STANDOFF,
): Vec2 {
  let nearestX = 0;
  let nearestY = 0;
  let bestD2 = Infinity;
  for (const b of blockPositions) {
    const dx = roverPos.X - b.X;
    const dy = roverPos.Y - b.Y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      nearestX = b.X;
      nearestY = b.Y;
    }
  }
  if (bestD2 === Infinity || bestD2 >= standoff * standoff) return roverPos;

  const d = Math.sqrt(bestD2);
  let dirX: number;
  let dirY: number;
  if (d > 1e-3) {
    dirX = (roverPos.X - nearestX) / d;
    dirY = (roverPos.Y - nearestY) / d;
  } else {
    dirX = 0;
    dirY = -1;
  }
  return { X: nearestX + dirX * standoff, Y: nearestY + dirY * standoff };
}
