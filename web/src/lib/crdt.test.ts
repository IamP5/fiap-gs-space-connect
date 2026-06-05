// crdt.test.ts — the browser-side echo of the green Go merge suite (vitest node
// env). These mirror internal/core/world/world_test.go: merge is commutative,
// idempotent, associative; concurrent claims resolve to the lower rover id;
// higher version wins; Done is not demoted at equal version. This is the
// pre-scripted answer to a skeptical distributed-systems evaluator (issue 10).

import { describe, expect, it } from "vitest";
import { merge, mergeAll, nextPhase, type TaskRecord } from "./crdt";

const id = "dome-cap";

// A small value space (a handful of ids, low versions, a few assignees) so
// collisions and concurrent claims — the interesting cases — occur often, the
// same generator philosophy as world_test.go's genTask.
const sampleStatuses: TaskRecord["status"][] = ["UNCLAIMED", "LEASED", "DONE"];
const sampleAssignees = ["", "R1", "R2", "R3", "R6"];

// recordsForSameTask enumerates a deterministic spread of records that all
// describe the SAME task id — Merge is only meaningful for same-id records
// (ADR-0003), so the law checks run over this set rather than random noise.
function recordsForSameTask(): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const status of sampleStatuses) {
    for (const assignee of sampleAssignees) {
      for (let version = 0; version < 4; version++) {
        for (const leaseExpiry of [0, 2]) {
          out.push({ id, status, assignee, version, leaseExpiry });
        }
      }
    }
  }
  return out;
}

function taskEqual(a: TaskRecord, b: TaskRecord): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.assignee === b.assignee &&
    a.version === b.version &&
    (a.leaseExpiry ?? 0) === (b.leaseExpiry ?? 0)
  );
}

describe("merge laws (echo of world_test.go property tests)", () => {
  const records = recordsForSameTask();

  it("is commutative: merge(a,b) === merge(b,a)", () => {
    for (const a of records) {
      for (const b of records) {
        expect(taskEqual(merge(a, b), merge(b, a))).toBe(true);
      }
    }
  });

  it("is idempotent: merge(a,a) === a", () => {
    for (const a of records) {
      expect(taskEqual(merge(a, a), a)).toBe(true);
    }
  });

  it("is associative: merge(merge(a,b),c) === merge(a,merge(b,c))", () => {
    // A representative slice keeps the triple loop fast while still covering
    // version/status/assignee ties — the associativity-breaking cases.
    const slice = records.filter((_, i) => i % 7 === 0);
    for (const a of slice) {
      for (const b of slice) {
        for (const c of slice) {
          const left = merge(merge(a, b), c);
          const right = merge(a, merge(b, c));
          expect(taskEqual(left, right)).toBe(true);
        }
      }
    }
  });

  it("never fabricates a record — the result is always one operand", () => {
    for (const a of records) {
      for (const b of records) {
        const m = merge(a, b);
        expect(taskEqual(m, a) || taskEqual(m, b)).toBe(true);
      }
    }
  });
});

describe("merge tie-breaks (echo of TestMergeTieBreaks)", () => {
  const cases: { name: string; a: TaskRecord; b: TaskRecord; want: TaskRecord }[] = [
    {
      name: "higher version wins regardless of status",
      a: { id, status: "DONE", assignee: "", version: 1 },
      b: { id, status: "UNCLAIMED", assignee: "", version: 2 },
      want: { id, status: "UNCLAIMED", assignee: "", version: 2 },
    },
    {
      name: "equal version: Done beats Leased (terminal not demoted)",
      a: { id, status: "LEASED", assignee: "R1", version: 5 },
      b: { id, status: "DONE", assignee: "", version: 5 },
      want: { id, status: "DONE", assignee: "", version: 5 },
    },
    {
      name: "equal version: Leased beats Unclaimed",
      a: { id, status: "UNCLAIMED", assignee: "", version: 5 },
      b: { id, status: "LEASED", assignee: "R4", version: 5 },
      want: { id, status: "LEASED", assignee: "R4", version: 5 },
    },
    {
      name: "concurrent claim: same version+status, lower rover id wins",
      a: { id, status: "LEASED", assignee: "R5", version: 7 },
      b: { id, status: "LEASED", assignee: "R2", version: 7 },
      want: { id, status: "LEASED", assignee: "R2", version: 7 },
    },
  ];

  for (const tc of cases) {
    it(tc.name, () => {
      expect(taskEqual(merge(tc.a, tc.b), tc.want)).toBe(true);
      // Commutativity must hold for the concrete cases too.
      expect(taskEqual(merge(tc.b, tc.a), tc.want)).toBe(true);
    });
  }
});

describe("concurrent claim resolves to the lower rover id (the headline guarantee)", () => {
  // The narrative's exact scenario: both rovers concurrently claim dome-cap at
  // the same version — A→R3, B→R6 — and the lower id (R3) always wins, in
  // either merge order (issue 10 acceptance criterion).
  it("A→R3 vs B→R6 at equal version both land on R3", () => {
    const a: TaskRecord = { id, status: "LEASED", assignee: "R3", version: 4 };
    const b: TaskRecord = { id, status: "LEASED", assignee: "R6", version: 4 };
    expect(merge(a, b).assignee).toBe("R3");
    expect(merge(b, a).assignee).toBe("R3");
  });

  it("holds across the whole leased value space", () => {
    for (let version = 0; version < 4; version++) {
      for (const lo of sampleAssignees.filter((x) => x !== "")) {
        for (const hi of sampleAssignees.filter((x) => x > lo)) {
          const a: TaskRecord = { id, status: "LEASED", assignee: lo, version };
          const b: TaskRecord = { id, status: "LEASED", assignee: hi, version };
          expect(merge(a, b).assignee).toBe(lo);
          expect(merge(b, a).assignee).toBe(lo);
        }
      }
    }
  });
});

describe("mergeAll is order-independent (echo of TestApplyPermutationInvariant)", () => {
  it("folds any permutation of divergent copies to the same winner", () => {
    const copies: TaskRecord[] = [
      { id, status: "UNCLAIMED", assignee: "", version: 1 },
      { id, status: "LEASED", assignee: "R6", version: 2 },
      { id, status: "LEASED", assignee: "R3", version: 2 },
      { id, status: "DONE", assignee: "", version: 2 },
    ];
    // DONE at the highest version is the deterministic winner.
    const want: TaskRecord = { id, status: "DONE", assignee: "", version: 2 };

    const permutations: TaskRecord[][] = [
      [copies[0], copies[1], copies[2], copies[3]],
      [copies[3], copies[2], copies[1], copies[0]],
      [copies[2], copies[0], copies[3], copies[1]],
      [copies[1], copies[3], copies[0], copies[2]],
    ];
    for (const perm of permutations) {
      expect(taskEqual(mergeAll(perm), want)).toBe(true);
    }
  });

  it("throws on an empty input", () => {
    expect(() => mergeAll([])).toThrow();
  });
});

describe("nextPhase state machine", () => {
  it("advances PARTITIONED → RECONCILING → CONVERGED and rests at CONVERGED", () => {
    expect(nextPhase("PARTITIONED")).toBe("RECONCILING");
    expect(nextPhase("RECONCILING")).toBe("CONVERGED");
    expect(nextPhase("CONVERGED")).toBe("CONVERGED");
  });
});
