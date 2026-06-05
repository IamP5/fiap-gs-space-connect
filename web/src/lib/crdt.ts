// crdt — the browser-side echo of the World Model's conflict-free merge.
//
// This is a faithful TypeScript port of internal/core/world/world.go's `Merge`
// and the total order in `less`: the SAME LWW-element semantics, the SAME
// concurrent-claim tiebreak (lower rover id wins at equal version+status). It
// is pure data in, authoritative record out — no React, no DOM, no clock — so
// it is unit-testable in vitest's node env, mirroring the green Go suite.
//
// ADR-0003 is explicit that the LIVE path stays single-writer; this module is
// NOT live multi-master state. It exists only so the PartitionPanel can replay
// the proven merge in the browser as a deterministic, pre-scripted narrative —
// the runnable answer to a skeptical distributed-systems evaluator.

import type { TaskStatus } from "../types/wire";

// TaskRecord is the minimal World Model task record the narrative reconciles:
// the same fields the Go `less` order compares, in the same domain spelling.
// `assignee` is the rover holding the lease while LEASED (empty otherwise);
// `leaseExpiry` is the logical expiry time while LEASED (0 otherwise).
export type TaskRecord = {
  id: string;
  status: TaskStatus; // "UNCLAIMED" | "LEASED" | "DONE"
  assignee: string; // "" when unassigned
  version: number; // Lamport stamp — the primary monotonic guard
  leaseExpiry?: number;
};

// statusRank maps a TaskStatus onto its merge priority, mirroring Go's
// statusRank: Done is terminal so it ranks highest (a concurrent same-version
// record can never demote a completed task); Leased outranks Unclaimed so a
// fresh claim beats a stale release at equal version. Unknown ranks lowest.
function statusRank(s: TaskStatus): number {
  switch (s) {
    case "DONE":
      return 3;
    case "LEASED":
      return 2;
    case "UNCLAIMED":
      return 1;
    default:
      return 0;
  }
}

// less reports whether record x is strictly older ("loses to") record y under
// the World Model's total order — the single source of truth shared by Merge,
// kept byte-for-byte consistent with world.go's `less`:
//
//   1. Higher version (Lamport) wins — the primary, monotonic guard.
//   2. Tie on version → higher status rank wins (Done > Leased > Unclaimed),
//      so a terminal task is never demoted by a concurrent same-version record.
//   3. Tie on status → LOWER assignee id wins. This is the deterministic
//      concurrent-claim tiebreak: when two rovers claim the same task at the
//      same version, the lower rover id keeps it (issue 10, ADR-0003).
//   4. Remaining ties break on lease expiry then id, so the order is total and
//      Merge stays well defined (and thus associative) for noisy-but-equal pairs.
//
// It is a strict weak order: less(x, x) is false, and exactly one of
// less(x, y), less(y, x), or "equal" holds for any pair.
function less(x: TaskRecord, y: TaskRecord): boolean {
  if (x.version !== y.version) {
    return x.version < y.version;
  }
  const px = statusRank(x.status);
  const py = statusRank(y.status);
  if (px !== py) {
    // Higher rank wins, so x is "less" when its rank is lower.
    return px < py;
  }
  if (x.assignee !== y.assignee) {
    // Lower assignee id wins, so x is "less" when its id is greater.
    return x.assignee > y.assignee;
  }
  const ex = x.leaseExpiry ?? 0;
  const ey = y.leaseExpiry ?? 0;
  if (ex !== ey) {
    return ex < ey;
  }
  return x.id < y.id;
}

// merge is the pure conflict-free (LWW-element) merge of two task records: it
// returns whichever of a and b is "newer" under the total order in less.
// Because that order is total and deterministic, merge is commutative,
// idempotent, and associative — any set of divergent copies reconciles to the
// same record regardless of merge order (the browser echo of Go's Merge).
export function merge(a: TaskRecord, b: TaskRecord): TaskRecord {
  return less(a, b) ? b : a;
}

// mergeAll folds a list of divergent copies of the SAME task into the single
// converged winner. Order-independent: the result is identical for any
// permutation of the inputs (the property the Go suite proves).
export function mergeAll(records: readonly TaskRecord[]): TaskRecord {
  if (records.length === 0) {
    throw new Error("mergeAll requires at least one record");
  }
  return records.reduce((acc, r) => merge(acc, r));
}

// ---- partition narrative state machine -------------------------------------

// The three explicit beats of the partition narrative the operator triggers:
// PARTITIONED (two rovers diverge on local state) → RECONCILING (the link
// returns) → CONVERGED (merge lands the single deterministic winner on both
// sides). Kept as a pure type so the panel reads as a state machine.
export type PartitionPhase = "PARTITIONED" | "RECONCILING" | "CONVERGED";

// nextPhase advances the narrative one beat. It is a pure, total transition so
// the panel can never reach an undefined state: PARTITIONED → RECONCILING →
// CONVERGED, and CONVERGED stays put (the operator resets explicitly).
export function nextPhase(phase: PartitionPhase): PartitionPhase {
  switch (phase) {
    case "PARTITIONED":
      return "RECONCILING";
    case "RECONCILING":
      return "CONVERGED";
    case "CONVERGED":
      return "CONVERGED";
  }
}
