// roverStandoff — render-only clearance so a rover parks IN FRONT of the structure
// it builds instead of embedding in it.
//
// A rover's authoritative sim position is the block CENTRE: it drives to the task
// position and works there (internal/agent drive→work), and after its last task it
// never moves off, so it comes to rest dead-centre in the block. Since the hero rover
// is scaled ~5.5× for readability (Scene3D ROVER_HERO_SCALE) it now dwarfs the ~0.9 u
// wall/foundation blocks and visibly swallows them — at the end of a build every rover
// looks stuck inside the thing it made. This is purely a MESH-CLEARANCE problem, so
// the fix lives in the renderer: nudge the rover's DRAWN position out in front of the
// block it sits on, leaving its real (snapshot) position — and therefore the auction,
// the lease, and the deterministic choreography — untouched (ADR-0004 snapshot purity).

import type { Vec2 } from "../types/wire";

// BUILD_STANDOFF is the clearance, in worksite units, held between a rover's centre
// and the centre of the block it sits at. The hero rover (GLB body + its halo/dust
// footprint, scaled ~5.5×) reaches further than its bare bounding box, so the value
// is tuned EMPIRICALLY from the rendered scene rather than the primitive math: at 3.5
// the body still kissed the block, so 6 is the distance at which it sits clearly IN
// FRONT with a small, legible gap. This is the single tuning knob — raise it if the
// rover model's footprint grows, lower it if the rover should hug its block closer.
export const BUILD_STANDOFF = 6;

// roverStandoffPos returns the position a rover should be DRAWN at. While the rover is
// farther than `standoff` from every block, its true position is returned unchanged
// (by reference), so the long drive across the regolith still reads normally. Once it
// is within `standoff` of its nearest block — driving the final stretch, building, or
// parked on a finished one — it is pushed out to the standoff ring along its APPROACH
// side (back toward where it came from), so it settles just in front of the block on
// the side it drove in from. Because the sim drives in a straight line to the block
// centre, that approach bearing is constant over the final stretch, so the drawn rover
// eases onto the ring with no sideways slide. When it sits exactly on the centre (the
// bearing is undefined) it falls back to −Y — the side rovers park and approach from,
// and the camera's near side — so a finished rover faces the viewer.
//
// Pure function of the snapshot (rover position + block positions): no client state,
// and the rover's real position is never mutated.
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
  // No blocks, or already clear of the nearest one: draw the rover where it really is.
  if (bestD2 === Infinity || bestD2 >= standoff * standoff) return roverPos;

  const d = Math.sqrt(bestD2);
  let dirX: number;
  let dirY: number;
  if (d > 1e-3) {
    dirX = (roverPos.X - nearestX) / d; // approach side: away from the block centre
    dirY = (roverPos.Y - nearestY) / d;
  } else {
    dirX = 0; // dead-centre on the block: face the viewer / parked side
    dirY = -1;
  }
  return { X: nearestX + dirX * standoff, Y: nearestY + dirY * standoff };
}
