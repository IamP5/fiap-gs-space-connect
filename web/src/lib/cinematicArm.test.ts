// cinematicArm.test.ts — pure arm-flag + cue-keystroke logic (vitest node env).

import { describe, expect, it } from "vitest";
import {
  ARM_TOGGLE_KEY,
  CUE_KILL_KEY,
  armedFromSearch,
  isArmToggle,
  isCueKill,
  isTypingTarget,
} from "./cinematicArm";

const noMods = { metaKey: false, ctrlKey: false, altKey: false };

describe("armedFromSearch", () => {
  it("arms only on reel=1", () => {
    expect(armedFromSearch("?reel=1")).toBe(true);
    expect(armedFromSearch("reel=1")).toBe(true);
    expect(armedFromSearch("?foo=bar&reel=1")).toBe(true);
  });

  it("stays disarmed for anything else (normal app unchanged)", () => {
    expect(armedFromSearch("")).toBe(false);
    expect(armedFromSearch("?")).toBe(false);
    expect(armedFromSearch("?reel=0")).toBe(false);
    expect(armedFromSearch("?reel=true")).toBe(false);
    expect(armedFromSearch("?reel")).toBe(false);
    expect(armedFromSearch("?other=1")).toBe(false);
  });
});

describe("isArmToggle", () => {
  it("matches the bare arm key in either case", () => {
    expect(isArmToggle({ key: ARM_TOGGLE_KEY, ...noMods })).toBe(true);
    expect(isArmToggle({ key: "R", ...noMods })).toBe(true);
  });

  it("ignores modifier combos so it never hijacks a shortcut", () => {
    expect(isArmToggle({ key: "r", ...noMods, metaKey: true })).toBe(false);
    expect(isArmToggle({ key: "r", ...noMods, ctrlKey: true })).toBe(false);
    expect(isArmToggle({ key: "r", ...noMods, altKey: true })).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isArmToggle({ key: "h", ...noMods })).toBe(false);
    expect(isArmToggle({ key: CUE_KILL_KEY, ...noMods })).toBe(false);
  });
});

describe("isCueKill", () => {
  it("matches the bare cue key in either case", () => {
    expect(isCueKill({ key: CUE_KILL_KEY, ...noMods })).toBe(true);
    expect(isCueKill({ key: "K", ...noMods })).toBe(true);
  });

  it("ignores modifier combos", () => {
    expect(isCueKill({ key: "k", ...noMods, metaKey: true })).toBe(false);
  });

  it("ignores other keys", () => {
    expect(isCueKill({ key: ARM_TOGGLE_KEY, ...noMods })).toBe(false);
  });
});

describe("keybinds do not collide", () => {
  it("arm and cue keys are distinct, and neither is the existing H bind", () => {
    expect(ARM_TOGGLE_KEY).not.toBe(CUE_KILL_KEY);
    expect(ARM_TOGGLE_KEY).not.toBe("h");
    expect(CUE_KILL_KEY).not.toBe("h");
  });
});

describe("isTypingTarget", () => {
  it("yields to text-entry contexts", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ isContentEditable: true })).toBe(true);
  });

  it("fires elsewhere", () => {
    expect(isTypingTarget({ tagName: "DIV" })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
