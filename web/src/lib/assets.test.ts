
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
    expect(GLB_ASSETS.length).toBeGreaterThan(0);
    expect(TEXTURE_ASSETS.length).toBeGreaterThan(0);
    expect(HDR_ASSETS.length).toBeGreaterThan(0);
  });

  it("references only public /assets URLs", () => {
    for (const url of ALL_ASSETS) {
      expect(url.startsWith("/assets/")).toBe(true);
    }
  });
});
