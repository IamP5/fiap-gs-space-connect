// assets.test.ts — the preload manifest is the single source of truth for "load
// everything before reveal", so the load-bearing guarantees are STRUCTURAL: it must
// be non-empty (an empty manifest would reveal instantly and reintroduce pop-in)
// and free of duplicate URLs (a dupe would double-count progress and skew the bar).
// The URLs themselves are imported from the rendering modules, so this also proves
// those exports resolve (the manifest can't silently drift).

import { describe, expect, it } from "vitest";
import { ALL_ASSETS, GLB_ASSETS, TEXTURE_ASSETS, HDR_ASSETS } from "./assets";

describe("asset manifest", () => {
  it("is non-empty", () => {
    expect(ALL_ASSETS.length).toBeGreaterThan(0);
  });

  it("has no duplicate URLs", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const url of ALL_ASSETS) {
      if (seen.has(url)) dupes.push(url);
      seen.add(url);
    }
    expect(dupes).toEqual([]);
  });

  it("covers every loader partition", () => {
    // Each partition contributes at least one asset, so a regression that empties a
    // category (e.g. the scenery refs stop exporting) is caught.
    expect(GLB_ASSETS.length).toBeGreaterThan(0);
    expect(TEXTURE_ASSETS.length).toBeGreaterThan(0);
    expect(HDR_ASSETS.length).toBeGreaterThan(0);
  });

  it("references only public /assets URLs", () => {
    // Every preloaded URL must be a same-origin public asset (no CDN), matching the
    // offline-first vendoring decision (no gstatic/CDN fetches).
    for (const url of ALL_ASSETS) {
      expect(url.startsWith("/assets/")).toBe(true);
    }
  });
});
