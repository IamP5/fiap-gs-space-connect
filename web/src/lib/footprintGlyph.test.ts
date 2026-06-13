
import { describe, expect, it } from "vitest";
import { footprintGlyph, GLYPH_VIEWBOX } from "./footprintGlyph";
import { blueprintById, CATALOG } from "./blueprintCatalog";

describe("footprintGlyph", () => {
  it("emits one cell per catalog task for every blueprint", () => {
    for (const bp of CATALOG) {
      const glyph = footprintGlyph(bp);
      expect(glyph.rects).toHaveLength(bp.tasks.length);
      expect(glyph.viewBox).toBe(GLYPH_VIEWBOX);
      expect(glyph.rects.map((r) => r.id)).toEqual(bp.tasks.map((t) => t.id));
    }
  });

  it("keeps every projected cell inside the viewBox", () => {
    for (const bp of CATALOG) {
      const glyph = footprintGlyph(bp);
      for (const r of glyph.rects) {
        expect(Number.isFinite(r.cx)).toBe(true);
        expect(Number.isFinite(r.cy)).toBe(true);
        expect(r.cx - r.halfX).toBeGreaterThanOrEqual(-0.001);
        expect(r.cy - r.halfY).toBeGreaterThanOrEqual(-0.001);
        expect(r.cx + r.halfX).toBeLessThanOrEqual(GLYPH_VIEWBOX + 0.001);
        expect(r.cy + r.halfY).toBeLessThanOrEqual(GLYPH_VIEWBOX + 0.001);
      }
    }
  });

  it("centres the schematic's bounding box in the viewBox", () => {
    const glyph = footprintGlyph(blueprintById("dome")!);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of glyph.rects) {
      minX = Math.min(minX, r.cx - r.halfX);
      minY = Math.min(minY, r.cy - r.halfY);
      maxX = Math.max(maxX, r.cx + r.halfX);
      maxY = Math.max(maxY, r.cy + r.halfY);
    }
    expect((minX + maxX) / 2).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
    expect((minY + maxY) / 2).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
  });

  it("reflects each blueprint's real task count (dome ring, two pads, one mast)", () => {
    expect(footprintGlyph(blueprintById("dome")!).rects).toHaveLength(13);
    expect(footprintGlyph(blueprintById("solar-array")!).rects).toHaveLength(4);
    expect(footprintGlyph(blueprintById("comms-mast")!).rects).toHaveLength(3);
  });

  it("projects a single coincident-point layout to a centred, finite mark", () => {
    const glyph = footprintGlyph(blueprintById("comms-mast")!);
    expect(glyph.rects.every((r) => Number.isFinite(r.cx) && Number.isFinite(r.cy))).toBe(true);
    for (const r of glyph.rects) {
      expect(r.cx).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
      expect(r.cy).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
    }
  });
});
