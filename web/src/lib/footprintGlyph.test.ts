// footprintGlyph.test.ts — the hotbar glyph projection is pure math (no React, no
// DOM), so it runs in vitest's node env. We assert the invariants the bottom-bar
// icons ride on: (1) every catalog task becomes one projected cell; (2) the
// schematic is centred in the viewBox and stays within its bounds; (3) the cell
// COUNT and rough shape match the real blueprint layout (dome = 12 footprints +
// cap, array = 4, mast = 3); (4) a single-point layout (the mast's coincident
// tasks) still projects to a centred mark rather than NaN.

import { describe, expect, it } from "vitest";
import { footprintGlyph, GLYPH_VIEWBOX } from "./footprintGlyph";
import { blueprintById, CATALOG } from "./blueprintCatalog";

describe("footprintGlyph", () => {
  it("emits one cell per catalog task for every blueprint", () => {
    for (const bp of CATALOG) {
      const glyph = footprintGlyph(bp);
      expect(glyph.rects).toHaveLength(bp.tasks.length);
      expect(glyph.viewBox).toBe(GLYPH_VIEWBOX);
      // Cell ids are preserved from the tasks (stable React keys + traceability).
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
    // The dome is symmetric about the origin → its projected bounding-box centre
    // must land at the viewBox centre.
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
    expect(footprintGlyph(blueprintById("dome")!).rects).toHaveLength(13); // 4 foundations + 8 walls + cap
    expect(footprintGlyph(blueprintById("solar-array")!).rects).toHaveLength(4); // 2 pads + 2 panels
    expect(footprintGlyph(blueprintById("comms-mast")!).rects).toHaveLength(3); // base + mast + antenna
  });

  it("projects a single coincident-point layout to a centred, finite mark", () => {
    // The comms mast's three tasks all sit at rel {0,0}; the projection must not
    // divide by a zero span — it should centre them rather than emit NaN.
    const glyph = footprintGlyph(blueprintById("comms-mast")!);
    expect(glyph.rects.every((r) => Number.isFinite(r.cx) && Number.isFinite(r.cy))).toBe(true);
    // All three tasks sit at rel {0,0}, so every projected cell must be centred on
    // the viewBox centre (a stacked, point-like mark) rather than scattered.
    for (const r of glyph.rects) {
      expect(r.cx).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
      expect(r.cy).toBeCloseTo(GLYPH_VIEWBOX / 2, 4);
    }
  });
});
