// copy.test.ts — the pure cinematic-copy data + cursor/keystroke logic.
//
// Asserts: every script §6 beat is present VERBATIM, variants/locks are tagged
// correctly, the beat-locked set is exactly the three event-naming lines, the
// cursor clamps without wrap, and the `]`/`[` step keys resolve a direction (and
// yield to modifiers). Runs in vitest's node env (no DOM, no React).

import { describe, expect, it } from "vitest";
import {
  BEAT_LOCKED_IDS,
  COPY_BEATS,
  COPY_NEXT_KEY,
  COPY_PREV_KEY,
  copyStepDir,
  stepCursor,
  type CopyVariant,
} from "./copy";

const noMods = { metaKey: false, ctrlKey: false, altKey: false };

describe("COPY_BEATS data", () => {
  it("carries the script §6 strings verbatim, in order", () => {
    const lines = COPY_BEATS.flatMap((b) => b.lines);
    // Spot-check the load-bearing beats verbatim (PT-BR, exact punctuation).
    expect(lines).toContain("SWARMBUILD");
    expect(lines).toContain("LUNAR BASE · operacional");
    expect(lines).toContain("SHACKLETON · em construção");
    expect(lines).toContain("Regolito destrói robôs. Falha é esperada.");
    expect(lines).toContain(
      "Terra a 2.6s: nenhum operador humano reage a tempo.",
    );
    expect(lines).toContain("O enxame está construindo sozinho.");
    expect(lines).toContain(
      "PRÓXIMA → SHACKLETON · cratera em sombra permanente",
    );
    expect(lines).toContain("SHACKLETON · CONSTRUÍDA NO ESCURO");
    expect(lines).toContain("CÚPULA HABITAT · fundações → paredes → selagem");
    expect(lines).toContain("Terra observa, +2.6s atrás.");
    expect(lines).toContain("ROBÔ PERDIDO · lease expirou");
    expect(lines).toContain(
      "RE-LEILÃO → CÚPULA FECHADA · zero humano no loop",
    );
    expect(lines).toContain(
      "TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.",
    );
    expect(lines).toContain("SHACKLETON · operacional");
    expect(lines).toContain(
      "SwarmBuild — construção autônoma que se cura sozinha. Feita para a Lua, antes de chegarmos.",
    );
    expect(lines).toContain(
      "Auto-cura = expiração de lease + re-leilão. Decisões na borda. Terra fora do loop.",
    );
  });

  it("burns in NO rover/task counts (MissionHud owns the live numbers)", () => {
    for (const line of COPY_BEATS.flatMap((b) => b.lines)) {
      expect(line).not.toMatch(/\b\d+\s*\/\s*\d+\b/); // e.g. "6/6"
    }
  });

  it("opens and closes on the wordmark (bookend)", () => {
    expect(COPY_BEATS[0].variant).toBe("wordmark");
    const lastWordmark = [...COPY_BEATS]
      .reverse()
      .find((b) => b.variant === "wordmark");
    expect(lastWordmark?.id).toBe("bookend-payoff");
  });

  it("uses only the known variants", () => {
    const known: CopyVariant[] = [
      "wordmark",
      "stake",
      "objective",
      "card",
      "thesis",
      "cta",
    ];
    for (const b of COPY_BEATS) expect(known).toContain(b.variant);
    // Every variant is exercised at least once (distinct styling is the point).
    for (const v of known) {
      expect(COPY_BEATS.some((b) => b.variant === v)).toBe(true);
    }
  });

  it("has stable, unique ids", () => {
    const ids = COPY_BEATS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("beat-locked tagging (never-name-a-beat-early rule)", () => {
  it("locks EXACTLY the three event-naming lines, in script order", () => {
    expect(BEAT_LOCKED_IDS).toEqual([
      "climax-kill",
      "climax-seal",
      "climax-thesis",
    ]);
  });

  it("the locked lines are the kill, the seal, and the +2.6s thesis", () => {
    const locked = COPY_BEATS.filter((b) => b.lock === "beat").flatMap(
      (b) => b.lines,
    );
    expect(locked).toContain("ROBÔ PERDIDO · lease expirou");
    expect(locked).toContain("RE-LEILÃO → CÚPULA FECHADA · zero humano no loop");
    expect(locked).toContain(
      "TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo.",
    );
  });

  it("everything else is free narration (advance anytime)", () => {
    const free = COPY_BEATS.filter((b) => !BEAT_LOCKED_IDS.includes(b.id));
    for (const b of free) expect(b.lock).toBe("free");
  });
});

describe("stepCursor", () => {
  it("steps forward and back", () => {
    expect(stepCursor(-1, 1)).toBe(0);
    expect(stepCursor(0, 1)).toBe(1);
    expect(stepCursor(2, -1)).toBe(1);
  });

  it("clamps to a clean stage (-1) below the first beat — no wrap", () => {
    expect(stepCursor(-1, -1)).toBe(-1);
    expect(stepCursor(0, -1)).toBe(-1);
  });

  it("clamps to the last beat at the top — no wrap", () => {
    const last = COPY_BEATS.length - 1;
    expect(stepCursor(last, 1)).toBe(last);
  });
});

describe("copyStepDir", () => {
  it("maps the step keys to a direction", () => {
    expect(copyStepDir({ key: COPY_NEXT_KEY, ...noMods })).toBe(1);
    expect(copyStepDir({ key: COPY_PREV_KEY, ...noMods })).toBe(-1);
  });

  it("ignores other keys and modifier combos", () => {
    expect(copyStepDir({ key: "a", ...noMods })).toBe(0);
    expect(copyStepDir({ key: COPY_NEXT_KEY, ...noMods, metaKey: true })).toBe(0);
    expect(copyStepDir({ key: COPY_PREV_KEY, ...noMods, ctrlKey: true })).toBe(0);
  });

  it("does not collide with the taken keys", () => {
    for (const key of ["r", "k", "h", "l", "Escape"]) {
      expect(copyStepDir({ key, ...noMods })).toBe(0);
    }
  });
});
