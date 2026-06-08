// reel/copy — the burned-in PT-BR copy beats for the Epic 07 demo cinematic.
//
// This is Scenery (DEMO-CINEMATIC-SCRIPT §6): non-diegetic on-screen text that
// the operator burns in over the live scene during a take. It encodes ZERO World
// Model state — it invents no snapshot/wire fields, reads nothing from the
// server, and is gated entirely on the client-only `cinematic` arm flag (#155).
// It is pure data + types so it unit-tests in vitest's node env (no DOM, no
// React). The component (CinematicCopy.tsx) is the only consumer.
//
// Strings are lifted VERBATIM from DEMO-CINEMATIC-SCRIPT.md §6 (PT-BR primary).
// Do NOT paraphrase or "improve" them here — §6 is the locked source of truth and
// any drift desyncs the burned-in copy from the roteiro. Note §6's standing rule:
// NO burned-in rover/task counts (MissionHud renders the true live numbers), so
// none appear below.
//
// ── The "never name a beat before it happens" rule (grilling outcome 4) ──────
// Each entry carries a `lock` tag:
//   · "free"  — free narration; the operator may advance to it ANY time. Setup
//               copy, markers, stakes, objectives, the wordmark/CTA bookend.
//   · "beat"  — BEAT-LOCKED. The line NAMES a live worksite event (the kill, the
//               re-auction/seal, the Earth-lag thesis). The operator MUST land it
//               AFTER the real event fires on screen, never before — otherwise the
//               Scenery would fabricate Choreography ("Choreography is never
//               fabricated", CONTEXT.md).
//
// This tag is a DOCUMENTED CAPTURE-CHECKLIST rule, NOT a gating engine. We do not
// block the cursor on beat-locked entries (no World Model clock to gate against,
// and a hard gate would couple Scenery to engine state — exactly what ADR-0004
// forbids). The operator enforces it by hand, cued by this tag + the checklist in
// docs/07-demo-cinematic/DEMO-CINEMATIC-SCRIPT.md §6 / IMPLEMENTATION-PLAN Slice 3.
// The three beat-locked lines are, in order: `ROBÔ PERDIDO` (the kill, Beat 11),
// `RE-LEILÃO → CÚPULA FECHADA` (the seal, Beat 12), and the `TERRA +2.6s ATRÁS`
// thesis (Beat 13).

// The visual treatment of a beat. Each variant is styled distinctly in reel.css
// so the operator reads the role at a glance and the burned-in copy matches the
// roteiro's typographic intent:
//   · wordmark  — the SWARMBUILD brand mark (bookend open/close).
//   · stake     — the terse stakes lines (regolith kills robots; Earth too far).
//   · objective — a directive / "next →" call-to-move.
//   · card      — an arrival title card (a site name in the dark).
//   · thesis    — the load-bearing argument lines (latency, self-heal).
//   · cta       — the closing pitch / tagline over the orbit vista.
export type CopyVariant =
  | "wordmark"
  | "stake"
  | "objective"
  | "card"
  | "thesis"
  | "cta";

// Whether the operator may advance to this entry freely, or must wait for the
// real worksite event it names (see the rule above).
export type CopyLock = "free" | "beat";

// One advance-step of the copy overlay: the lines to burn in, how to style them,
// and whether the line is beat-locked. `lines` is an ordered list so a beat can
// stack a primary line + a secondary (e.g. wordmark + the two marker labels).
export interface CopyBeat {
  // Stable key for React lists + tests (NOT shown). Mirrors the script beat.
  readonly id: string;
  readonly variant: CopyVariant;
  readonly lock: CopyLock;
  readonly lines: readonly string[];
  // The script beat this copy lands on, for the capture checklist (e.g. "Beat 2").
  readonly beat: string;
}

// The ordered cursor list. The operator steps forward/back through these with the
// `]` / `[` keybind during a take. Order follows the roteiro's beat sheet.
// Strings VERBATIM from DEMO-CINEMATIC-SCRIPT §6.
export const COPY_BEATS: readonly CopyBeat[] = [
  // Beat 2 — sun reveal: wordmark blooms in with the two marker labels.
  {
    id: "wordmark-open",
    variant: "wordmark",
    lock: "free",
    beat: "Beat 2",
    lines: [
      "SWARMBUILD",
      "LUNAR BASE · operacional",
      "SHACKLETON · em construção",
    ],
  },
  // Beat 3 — the two stakes lines (one per advance, ~7s each).
  {
    id: "stake-regolith",
    variant: "stake",
    lock: "free",
    beat: "Beat 3",
    lines: ["Regolito destrói robôs. Falha é esperada."],
  },
  {
    id: "stake-latency",
    variant: "stake",
    lock: "free",
    beat: "Beat 3",
    lines: ["Terra a 2.6s: nenhum operador humano reage a tempo."],
  },
  // Beat 6 — Lunar Base, the working outpost + the call poleward.
  {
    id: "lunar-swarm",
    variant: "stake",
    lock: "free",
    beat: "Beat 6",
    lines: ["O enxame está construindo sozinho."],
  },
  {
    id: "objective-shackleton",
    variant: "objective",
    lock: "free",
    beat: "Beat 6",
    lines: ["PRÓXIMA → SHACKLETON · cratera em sombra permanente"],
  },
  // Beat 8 — Shackleton arrival title card.
  {
    id: "card-shackleton",
    variant: "card",
    lock: "free",
    beat: "Beat 8",
    lines: ["SHACKLETON · CONSTRUÍDA NO ESCURO"],
  },
  // Beat 9 — Lunar live build + the latency through-line.
  {
    id: "lunar-dome",
    variant: "objective",
    lock: "free",
    beat: "Beat 9",
    lines: ["CÚPULA HABITAT · fundações → paredes → selagem"],
  },
  {
    id: "lunar-earth-watch",
    variant: "stake",
    lock: "free",
    beat: "Beat 9",
    lines: ["Terra observa, +2.6s atrás."],
  },
  // ── BEAT-LOCKED from here: land AFTER the real worksite event fires. ─────────
  // Beat 11 — THE KILL. Land only after the rover dims + the lease beam severs.
  {
    id: "climax-kill",
    variant: "thesis",
    lock: "beat",
    beat: "Beat 11",
    lines: ["ROBÔ PERDIDO · lease expirou"],
  },
  // Beat 12 — THE SEAL. Land only after the survivor seats the cap + dome closes.
  {
    id: "climax-seal",
    variant: "thesis",
    lock: "beat",
    beat: "Beat 12",
    lines: ["RE-LEILÃO → CÚPULA FECHADA · zero humano no loop"],
  },
  // Beat 13 — THE THESIS. Land only after the seal, framed against the lagging
  // Earth panel reading +2.6s behind.
  {
    id: "climax-thesis",
    variant: "thesis",
    lock: "beat",
    beat: "Beat 13",
    lines: ["TERRA +2.6s ATRÁS — nenhum comando humano chegaria a tempo."],
  },
  // Beat 15 — the orbit bookend close: marker payoff + CTA + tech line, over the
  // pure vista (survives `H`). Free again — it lands on the wide, no live event.
  {
    id: "bookend-payoff",
    variant: "wordmark",
    lock: "free",
    beat: "Beat 15",
    lines: [
      "SWARMBUILD",
      "LUNAR BASE · operacional",
      "SHACKLETON · operacional",
    ],
  },
  {
    id: "bookend-cta",
    variant: "cta",
    lock: "free",
    beat: "Beat 15",
    lines: [
      "SwarmBuild — construção autônoma que se cura sozinha. Feita para a Lua, antes de chegarmos.",
    ],
  },
  {
    id: "bookend-tech",
    variant: "cta",
    lock: "free",
    beat: "Beat 15",
    lines: [
      "Auto-cura = expiração de lease + re-leilão. Decisões na borda. Terra fora do loop.",
    ],
  },
];

// Step a cursor through COPY_BEATS, clamped to the bounds (no wrap — the operator
// lands the last beat and holds it on the closing vista). `dir` is +1 (next) or
// -1 (prev). A cursor of -1 means "nothing shown yet" (the clean-stage open),
// so stepping back past the first beat returns to a clean stage. Pure so the
// keybind logic unit-tests without React. Clamps to [-1, len-1].
export function stepCursor(
  cursor: number,
  dir: 1 | -1,
  length: number = COPY_BEATS.length,
): number {
  const next = cursor + dir;
  if (next < -1) return -1;
  if (next > length - 1) return length - 1;
  return next;
}

// The beat-locked subset, for the capture checklist + tests. These are the lines
// the operator must land AFTER the real event (never before).
export const BEAT_LOCKED_IDS: readonly string[] = COPY_BEATS.filter(
  (b) => b.lock === "beat",
).map((b) => b.id);

// ── Copy-step keybinds ───────────────────────────────────────────────────────
// The operator steps the cursor with `]` (next) / `[` (prev). Chosen to avoid the
// keys already taken: `r` (arm), `k` (cueKill), `h` (HUD hide), `Escape` (cancel
// placement), `l`/`L` (place while placing). Kept here next to the data so the
// App's keydown handler + the test agree on the single source of truth.
export const COPY_NEXT_KEY = "]";
export const COPY_PREV_KEY = "[";

// Returns the step direction for a bare copy-step keystroke, or 0 if the event is
// neither step key (or carries a modifier — so it never hijacks a browser/OS
// shortcut, mirroring the arm/cue guards). The caller gates this on `armed` so a
// disarmed press is a no-op. Pure so it unit-tests without a DOM.
export function copyStepDir(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): 1 | -1 | 0 {
  if (e.metaKey || e.ctrlKey || e.altKey) return 0;
  if (e.key === COPY_NEXT_KEY) return 1;
  if (e.key === COPY_PREV_KEY) return -1;
  return 0;
}
