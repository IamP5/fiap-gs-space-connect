// lab.test.ts — the SSE parsing + verdict summary are pure (no DOM, no network),
// so they run in vitest's node env. The agent-console feed (bh-07a) must parse the
// gateway's `data:` frames robustly and never crash on a partial/keep-alive frame.

import { describe, expect, it } from "vitest";
import {
  type LabEvent,
  parseSSEEvent,
  splitSSEStream,
  verdictPassed,
  verdictSummary,
} from "./lab";

describe("parseSSEEvent", () => {
  it("parses a data: line into a typed LabEvent", () => {
    const e = parseSSEEvent('data: {"kind":"started","task_type":"foundation"}');
    expect(e).not.toBeNull();
    expect(e!.kind).toBe("started");
    expect(e!.task_type).toBe("foundation");
  });

  it("parses an ops frame with build ops", () => {
    const e = parseSSEEvent('data: {"kind":"ops","iter":1,"ops":[{"shape":"box"},{"shape":"sphere"}]}');
    expect(e!.kind).toBe("ops");
    expect(e!.iter).toBe(1);
    expect(e!.ops).toHaveLength(2);
  });

  it("returns null for a non-data line (keep-alive / comment)", () => {
    expect(parseSSEEvent(": keep-alive")).toBeNull();
    expect(parseSSEEvent("event: ping")).toBeNull();
    expect(parseSSEEvent("")).toBeNull();
  });

  it("returns null for malformed JSON (defensive — never crashes the console)", () => {
    expect(parseSSEEvent("data: {not json")).toBeNull();
    expect(parseSSEEvent("data: 42")).toBeNull(); // not an object
  });
});

describe("splitSSEStream", () => {
  it("splits complete frames and carries the incomplete tail forward", () => {
    const buf =
      'data: {"kind":"started"}\n\ndata: {"kind":"ops","iter":1}\n\ndata: {"kind":"verd';
    const { blocks, rest } = splitSSEStream(buf);
    expect(blocks).toHaveLength(2);
    expect(parseSSEEvent(blocks[0])!.kind).toBe("started");
    expect(parseSSEEvent(blocks[1])!.kind).toBe("ops");
    expect(rest).toBe('data: {"kind":"verd');
  });

  it("normalises CRLF line endings", () => {
    const { blocks } = splitSSEStream('data: {"kind":"done"}\r\n\r\n');
    expect(blocks).toHaveLength(1);
    expect(parseSSEEvent(blocks[0])!.kind).toBe("done");
  });

  it("yields no blocks for a buffer with no complete frame", () => {
    const { blocks, rest } = splitSSEStream('data: {"kind":"st');
    expect(blocks).toHaveLength(0);
    expect(rest).toBe('data: {"kind":"st');
  });
});

describe("verdictSummary", () => {
  const passing: LabEvent = {
    kind: "verdict",
    iter: 1,
    pass: true,
    soft_score: 4,
    verdict: {
      hard_gate: { envelope: true, collision: true, done: true },
      rubric: {
        done_coverage: { score: 2, evidence: "" },
        silhouette: { score: 0, evidence: "" },
        coherence: { score: 2, evidence: "" },
      },
    },
  };

  it("summarises a passing verdict with gate marks", () => {
    const s = verdictSummary(passing);
    expect(s).toContain("PASS");
    expect(s).toContain("soft 4");
    expect(s).toContain("env✓");
    expect(s).toContain("col✓");
    expect(s).toContain("done✓");
  });

  // The backend omits `pass` on a FAILING verdict (Go omitempty on false), so the
  // summary must derive PASS/FAIL from the hard_gate — NOT the absent flag.
  it("summarises a failing verdict (with no `pass` field) as FAIL", () => {
    const failing: LabEvent = {
      kind: "verdict",
      iter: 2,
      soft_score: 1,
      // pass intentionally absent — mirrors the omitempty wire shape.
      verdict: {
        hard_gate: { envelope: false, collision: true, done: false },
        rubric: passing.verdict!.rubric,
      },
    };
    const s = verdictSummary(failing);
    expect(s).toContain("FAIL");
    expect(s).toContain("env✗");
    expect(s).toContain("col✓");
    expect(s).toContain("done✗");
  });

  it("returns empty string when there is no verdict", () => {
    expect(verdictSummary({ kind: "done" })).toBe("");
  });
});

describe("verdictPassed", () => {
  it("derives pass from the hard gate, ignoring an absent `pass` flag", () => {
    expect(
      verdictPassed({
        kind: "verdict",
        verdict: { hard_gate: { envelope: true, collision: true, done: true }, rubric: {} as never },
      }),
    ).toBe(true);
  });

  it("is false when any hard-gate invariant fails (even with `pass` absent)", () => {
    expect(
      verdictPassed({
        kind: "verdict",
        verdict: { hard_gate: { envelope: true, collision: false, done: true }, rubric: {} as never },
      }),
    ).toBe(false);
  });

  it("falls back to the `pass` flag when there is no verdict object", () => {
    expect(verdictPassed({ kind: "verdict", pass: true })).toBe(true);
    expect(verdictPassed({ kind: "verdict" })).toBe(false);
  });
});
