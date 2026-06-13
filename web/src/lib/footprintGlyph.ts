
import type { CatalogBlueprint } from "./blueprintCatalog";

export const GLYPH_VIEWBOX = 100;
const GLYPH_PADDING = 12;

export type GlyphRect = {
  id: string;
  cx: number;
  cy: number;
  halfX: number;
  halfY: number;
  round: boolean;
};

export type FootprintGlyph = {
  viewBox: number;
  rects: GlyphRect[];
};

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
  const scale = span > 0 ? inner / span : 1;

  const worldCx = (minX + maxX) / 2;
  const worldCy = (minY + maxY) / 2;
  const half = GLYPH_VIEWBOX / 2;

  const rects: GlyphRect[] = cells.map((c) => {
    const px = half + (c.cx - worldCx) * scale;
    const py = half + (c.cy - worldCy) * scale;
    const phx = Math.max(c.halfX * scale, 1.5);
    const phy = Math.max(c.halfY * scale, 1.5);
    const round = Math.max(phx, phy) <= inner * 0.18;
    return { id: c.id, cx: px, cy: py, halfX: phx, halfY: phy, round };
  });

  return { viewBox: GLYPH_VIEWBOX, rects };
}
