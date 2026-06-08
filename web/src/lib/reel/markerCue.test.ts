// markerCue.test.ts — the pure marker-cue cycle + keystroke logic.
//
// Asserts: the lock-on cycle steps null → lunar → shackleton → null (no wrap past
// null), the keystroke matchers resolve the bare keys and yield to modifiers, and
// the keybinds don't collide with the keys already taken by earlier slices. Runs
// in vitest's node env (no DOM, no React).

import { describe, expect, it } from "vitest";
import {
  cycleLockOn,
  isMarkerFlip,
  isMarkerLockOn,
  MARKER_CYCLE,
  MARKER_FLIP_KEY,
  MARKER_LOCKON_KEY,
} from "./markerCue";

const noMods = { metaKey: false, ctrlKey: false, altKey: false };

describe("cycleLockOn", () => {
  it("steps null → lunar → shackleton → null", () => {
    expect(cycleLockOn(null)).toBe("lunar");
    expect(cycleLockOn("lunar")).toBe("shackleton");
    expect(cycleLockOn("shackleton")).toBeNull();
  });

  it("round-trips back to the start", () => {
    let site = cycleLockOn(null);
    site = cycleLockOn(site);
    site = cycleLockOn(site);
    expect(site).toBeNull();
    expect(cycleLockOn(site)).toBe("lunar");
  });

  it("resets an unknown current value to the first marker", () => {
    expect(cycleLockOn("ganymede" as never)).toBe("lunar");
  });

  it("covers exactly the two orbit site markers", () => {
    expect([...MARKER_CYCLE]).toEqual(["lunar", "shackleton"]);
  });
});

describe("isMarkerLockOn", () => {
  it("matches the bare lock-on key (any case)", () => {
    expect(isMarkerLockOn({ key: "m", ...noMods })).toBe(true);
    expect(isMarkerLockOn({ key: "M", ...noMods })).toBe(true);
  });

  it("ignores modifier combos and other keys", () => {
    expect(isMarkerLockOn({ key: "m", ...noMods, metaKey: true })).toBe(false);
    expect(isMarkerLockOn({ key: "m", ...noMods, ctrlKey: true })).toBe(false);
    expect(isMarkerLockOn({ key: "m", ...noMods, altKey: true })).toBe(false);
    expect(isMarkerLockOn({ key: "x", ...noMods })).toBe(false);
  });
});

describe("isMarkerFlip", () => {
  it("matches the bare flip key (any case)", () => {
    expect(isMarkerFlip({ key: "b", ...noMods })).toBe(true);
    expect(isMarkerFlip({ key: "B", ...noMods })).toBe(true);
  });

  it("ignores modifier combos and other keys", () => {
    expect(isMarkerFlip({ key: "b", ...noMods, metaKey: true })).toBe(false);
    expect(isMarkerFlip({ key: "z", ...noMods })).toBe(false);
  });
});

describe("keybind collisions", () => {
  it("does not collide with the keys earlier slices already took", () => {
    // r=arm, k=cueKill, h=HUD-hide, ]/[=copy step, l=place, Escape=cancel.
    const taken = ["r", "k", "h", "]", "[", "l", "Escape"];
    expect(taken).not.toContain(MARKER_LOCKON_KEY);
    expect(taken).not.toContain(MARKER_FLIP_KEY);
    expect(MARKER_LOCKON_KEY).not.toBe(MARKER_FLIP_KEY);
  });
});
