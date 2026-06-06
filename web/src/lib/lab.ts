// lab — pure types + parsing for the in-app LIVE lab "watch it think" feed
// (bh-07a). The backend (internal/harness/lab) streams the real
// Generator↔Evaluator loop as Server-Sent Events; this module models one event
// and parses the SSE `data:` frames into them. It is three-free / DOM-free so it
// unit-tests in vitest's node env, mirroring lib/buildspec.ts.
//
// The lab is OFF the headline path: these events never touch the world Snapshot
// re-render — they are a separate console feed the operator opts into.

import type { BuildOp } from "../types/wire";

// One soft-rubric dimension as the Evaluator emits it (0–2 + cited evidence).
export type Score = { score: number; evidence: string };

// The Evaluator's layered verdict for one refine pass: a blocking hard gate plus
// the advisory soft rubric. Mirrors evaluator.Verdict's JSON exactly.
export type Verdict = {
  hard_gate: { envelope: boolean; collision: boolean; done: boolean };
  rubric: {
    done_coverage: Score;
    silhouette: Score;
    coherence: Score;
  };
};

// LabEventKind mirrors the backend lab.EventKind values.
export type LabEventKind = "started" | "ops" | "verdict" | "done" | "error";

// LabEvent is one streamed console frame. Only the fields relevant to `kind` are
// present; the rest are undefined (matching the Go `omitempty` marshalling).
export type LabEvent = {
  kind: LabEventKind;
  iter?: number;

  // started
  task_id?: string;
  task_type?: string;
  provider?: string;
  model?: string;

  // ops
  ops?: BuildOp[];

  // verdict
  verdict?: Verdict;
  pass?: boolean;
  reasons?: string[];
  soft_score?: number;

  // done
  result?: "accepted" | "fallback";
  quality_flag?: "ok" | "low";

  // done / error
  reason?: string;
};

// parseSSEEvent extracts the JSON payload from one SSE `data:` line (or a
// multi-line `data:` block) and parses it into a LabEvent. Returns null for a
// non-data line, an empty payload, or malformed JSON — so a stray keep-alive or a
// partial frame can never crash the console (defensive, like isSnapshot).
export function parseSSEEvent(block: string): LabEvent | null {
  const dataLines = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice("data:".length).trim());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join("\n");
  if (payload === "") return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const e = parsed as LabEvent;
    if (typeof e.kind !== "string") return null;
    return e;
  } catch {
    return null;
  }
}

// splitSSEStream splits a raw SSE text buffer into complete event blocks
// (separated by a blank line) plus the trailing INCOMPLETE remainder, so a
// streaming reader can parse whole frames and carry the partial tail forward. The
// remainder is "" when the buffer ends on a frame boundary.
export function splitSSEStream(buffer: string): { blocks: string[]; rest: string } {
  // Normalise CRLF so the blank-line split is robust across servers.
  const norm = buffer.replace(/\r\n/g, "\n");
  const parts = norm.split("\n\n");
  const rest = parts.pop() ?? "";
  return { blocks: parts.filter((p) => p.trim() !== ""), rest };
}

// verdictPassed reports whether a verdict event's hard gate passed. It reads the
// hard_gate fields DIRECTLY (always present in the verdict) rather than the
// top-level `pass` convenience flag — which the backend marshals with omitempty,
// so a FAILING verdict (pass=false) carries no `pass` field at all and
// `e.pass === false` would be undefined. Deriving from the gate is the robust
// signal the console renders fail-vs-pass from.
export function verdictPassed(e: LabEvent): boolean {
  const g = e.verdict?.hard_gate;
  if (!g) return e.pass === true; // no verdict ⇒ fall back to the flag
  return g.envelope && g.collision && g.done;
}

// verdictSummary renders a one-line, human summary of a verdict for the console
// (e.g. "PASS · soft 4/6 · env✓ col✓ done✓"). Pure, so it is unit-tested.
export function verdictSummary(e: LabEvent): string {
  const v = e.verdict;
  if (!v) return "";
  const g = v.hard_gate;
  const mark = (b: boolean) => (b ? "✓" : "✗");
  const gate = verdictPassed(e) ? "PASS" : "FAIL";
  const soft = `soft ${e.soft_score ?? 0}`;
  return `${gate} · ${soft} · env${mark(g.envelope)} col${mark(g.collision)} done${mark(g.done)}`;
}
