// PartitionPanel — the optional partition-tolerance narrative (issue 10), an
// explicitly opt-in "lab" affordance the operator triggers.
//
// ADR-0003 keeps the LIVE path single-writer, so this is NOT live multi-master
// world state: it is a SELF-CONTAINED, deterministic, pre-scripted narrative
// that replays the proven World Model merge (lib/crdt.ts) in the browser. Its
// phase is LOCAL UI state — it never routes through the snapshot, so the
// dashboard stays a pure re-render of the world (ADR-0004) and this panel can
// never pre-empt the headline heal. It docks to the right edge and collapses to
// its header so it never covers the central worksite.
//
// The narrative has three explicit beats — PARTITIONED → RECONCILING →
// CONVERGED. While PARTITIONED, two rovers hold divergent local copies of the
// SAME task (dome-cap) shown SIDE BY SIDE: a partition split them and both
// concurrently claimed it at the same version — view A → R3, view B → R6. On
// Reconcile the link returns and `merge` from crdt.ts folds both copies into the
// single deterministic winner (the lower rover id, R3), shown on both sides and
// in a "merged" result line — proving order-independent convergence.

import { memo, useCallback, useState } from "react";
import { merge, nextPhase, type PartitionPhase, type TaskRecord } from "../lib/crdt";

// The contested task both rovers claim during the partition. Same id, same
// version → a genuine concurrent claim the merge must resolve deterministically.
const TASK_ID = "dome-cap";
const CLAIM_VERSION = 4;

// View A's stale local copy: rover R3 holds the lease on dome-cap.
const VIEW_A: TaskRecord = { id: TASK_ID, status: "LEASED", assignee: "R3", version: CLAIM_VERSION };
// View B's stale local copy: rover R6 holds the same lease, concurrently.
const VIEW_B: TaskRecord = { id: TASK_ID, status: "LEASED", assignee: "R6", version: CLAIM_VERSION };
// The converged record both sides reconcile to, computed via the REAL merge so
// the panel never hard-codes the answer — the lower rover id (R3) wins.
const CONVERGED: TaskRecord = merge(VIEW_A, VIEW_B);

const PHASES: PartitionPhase[] = ["PARTITIONED", "RECONCILING", "CONVERGED"];

// Human-readable copy per phase, so the caption reads as a narrative.
const PHASE_CAPTION: Record<PartitionPhase, string> = {
  PARTITIONED: "link down — each rover trusts its own World Model; both leased dome-cap",
  RECONCILING: "link restored — folding both copies through the proven merge",
  CONVERGED: "order-independent — the lower rover id keeps the lease on both sides",
};

// RoverView renders one rover's local copy of the contested task as a compact
// card: a big assignee id over the task line, so the divergence (R3 vs R6) and
// the convergence (both R3) read at a glance.
function RoverView({ label, record }: { label: string; record: TaskRecord }) {
  return (
    <div className="partition-view">
      <span className="partition-view-label">{label}</span>
      <span className="partition-view-id">{record.assignee}</span>
      <span className="partition-view-task">
        {record.id} <span className="badge st-leased">{record.status}</span>
      </span>
    </div>
  );
}

export const PartitionPanel = memo(function PartitionPanel() {
  // The narrative phase is LOCAL UI state only — never world state (ADR-0004).
  const [phase, setPhase] = useState<PartitionPhase>("PARTITIONED");
  // Whether the card is expanded. Open by default — it is the showcase — but it
  // docks to the edge and can be collapsed to its header so the scene stays clear.
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((o) => !o), []);

  // Reconcile drives PARTITIONED → RECONCILING → CONVERGED. RECONCILING is a
  // brief explicit beat (the link returning) before the merge lands, so the
  // viewer sees the three labels rather than a single jump-cut.
  const reconcile = useCallback(() => {
    setPhase((p) => nextPhase(p));
    window.setTimeout(() => setPhase((p) => nextPhase(p)), 600);
  }, []);
  const reset = useCallback(() => setPhase("PARTITIONED"), []);

  const converged = phase === "CONVERGED";
  const activeIdx = PHASES.indexOf(phase);
  // CONVERGED shows the SAME winning record on both sides; otherwise each side
  // shows its own divergent local copy. Order-independent by construction.
  const left = converged ? CONVERGED : VIEW_A;
  const right = converged ? CONVERGED : VIEW_B;

  return (
    <aside className="lab-card partition-panel" data-open={open} aria-label="Partition narrative">
      <button type="button" className="lab-head" onClick={toggle} aria-expanded={open}>
        <span>Partition narrative · stretch</span>
        <span className="lab-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="lab-body">
          <div className="partition-phases" role="status" aria-live="polite">
            {PHASES.map((p, i) => (
              <span
                key={p}
                className={`partition-phase${i === activeIdx ? " is-active" : ""}${
                  i < activeIdx ? " is-done" : ""
                }`}
                aria-current={p === phase ? "step" : undefined}
              >
                {p}
              </span>
            ))}
          </div>

          <div className={`partition-split${converged ? " is-converged" : ""}`}>
            <RoverView label="Rover view A" record={left} />
            <RoverView label="Rover view B" record={right} />
          </div>

          {converged && (
            <div className="partition-merged">
              <span className="partition-merged-label">merged · {CONVERGED.id}</span>
              <span className="partition-merged-id">{CONVERGED.assignee}</span>
            </div>
          )}

          <p className="partition-caption">{PHASE_CAPTION[phase]}</p>

          {converged ? (
            <button type="button" className="partition-btn" onClick={reset}>
              Replay
            </button>
          ) : (
            <button
              type="button"
              className="partition-btn"
              onClick={reconcile}
              disabled={phase === "RECONCILING"}
            >
              {phase === "RECONCILING" ? "Reconciling…" : "Reconcile"}
            </button>
          )}
        </div>
      )}
    </aside>
  );
});
