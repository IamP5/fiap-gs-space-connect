// footprintGlyph — a PURE projection of a catalog Blueprint's real task layout
// into a normalized top-down schematic, for the bottom hotbar's icon glyphs
// (Epic 06 P1a). Each blueprint icon is NOT a generic picture: it is the literal
// footprint the operator is about to drop, derived from the SAME `rel.{X,Y}` task
// positions + `envelope.size` the ghost/coordinator use. So a dome reads as an
// 8-wall ring + 4 inner foundations, the solar array as two pads, the comms mast
// as a single point — a glanceable "what lands here" schematic.
//
// This module is pure (no React, no DOM) so it is unit-testable in vitest's node
// env; the Hotbar renders the returned rectangles as SVG <rect>s. We collapse the
// 3D world to its XY ground plane (top-down), centre on the layout's bounding box,
// and scale to a fixed viewBox so every glyph fills its button the same way.

import type { CatalogBlueprint } from "./blueprintCatalog";

// VIEWBOX is the normalized square the schematic is projected into. The shapes are
// laid out in this coordinate space so the SVG can declare `viewBox="0 0 V V"` and
// scale to any button size. A small PADDING inset keeps the outermost footprint
// off the very edge.
export const GLYPH_VIEWBOX = 100;
const GLYPH_PADDING = 12;

// A projected footprint cell: a centre + half-extents in viewBox units, with a
// corner radius hint so the renderer can round small marks into dots. All values
// are already in the normalized [0, GLYPH_VIEWBOX] space.
export type GlyphRect = {
  id: string;
  cx: number;
  cy: number;
  halfX: number;
  halfY: number;
  // Whether this cell is small/square enough to read as a dot (renderer may use a
  // circle / heavy corner radius). Derived from the projected extent.
  round: boolean;
};

export type FootprintGlyph = {
  viewBox: number; // square side; matches GLYPH_VIEWBOX
  rects: GlyphRect[];
};

// footprintGlyph projects a blueprint's tasks to a top-down schematic. For each
// task we take its `rel.{X,Y}` ground position and its `envelope.size.{X,Y}` XY
// extent (the same footprint the ghost draws), find the bounding box of ALL task
// footprints, then map that box into the padded viewBox preserving aspect ratio
// (uniform scale, centred) so the glyph never distorts. A degenerate (single
// point) layout still renders a centred mark.
export function footprintGlyph(blueprint: CatalogBlueprint): FootprintGlyph {
  const cells = blueprint.tasks.map((t) => {
    const hx = Math.abs(t.envelope.size.X) / 2;
    const hy = Math.abs(t.envelope.size.Y) / 2;
    return {
      id: t.id,
      cx: t.rel.X + t.envelope.center.X,
      cy: t.rel.Y + t.envelope.center.Y,
      halfX: hx,
      halfY: hy,
    };
  });

  // World-space bounding box across every footprint cell (centre ± half-extent).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    minX = Math.min(minX, c.cx - c.halfX);
    minY = Math.min(minY, c.cy - c.halfY);
    maxX = Math.max(maxX, c.cx + c.halfX);
    maxY = Math.max(maxY, c.cy + c.halfY);
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const span = Math.max(spanX, spanY);
  const inner = GLYPH_VIEWBOX - GLYPH_PADDING * 2;
  // Uniform scale: world units → viewBox units. A zero span (single coincident
  // point) maps to scale 1, then the centring below parks it dead-centre.
  const scale = span > 0 ? inner / span : 1;

  // Centre of the world bounding box → centre of the viewBox, so the schematic is
  // always centred regardless of where the blueprint's origin sits.
  const worldCx = (minX + maxX) / 2;
  const worldCy = (minY + maxY) / 2;
  const half = GLYPH_VIEWBOX / 2;

  const rects: GlyphRect[] = cells.map((c) => {
    // Project to viewBox space. Y is NOT flipped — the schematic is orientation-
    // agnostic (rotation-symmetric layouts) and the renderer treats +Y as down,
    // which is fine for a top-down icon.
    const px = half + (c.cx - worldCx) * scale;
    const py = half + (c.cy - worldCy) * scale;
    const phx = Math.max(c.halfX * scale, 1.5);
    const phy = Math.max(c.halfY * scale, 1.5);
    // A near-square mark whose larger extent is small reads as a dot.
    const round = Math.max(phx, phy) <= inner * 0.18;
    return { id: c.id, cx: px, cy: py, halfX: phx, halfY: phy, round };
  });

  return { viewBox: GLYPH_VIEWBOX, rects };
}
