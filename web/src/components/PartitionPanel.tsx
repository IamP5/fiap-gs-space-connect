// PartitionPanel — the optional partition-tolerance narrative (issue 10), an
// explicitly opt-in "encore" affordance the operator triggers.
//
// ADR-0003 keeps the LIVE path single-writer, so this is NOT live multi-master
// world state: it is a SELF-CONTAINED, deterministic, pre-scripted narrative
// that replays the proven World Model merge (lib/crdt.ts) in the browser. Its
// phase is LOCAL UI state — it never routes through the snapshot, so the
// dashboard stays a pure re-render of the world (ADR-0004) and this panel can
// never pre-empt the headline heal.
//
// The narrative has three explicit beats — PARTITIONED → RECONCILING →
// CONVERGED. While PARTITIONED, two rovers hold divergent local copies of the
// SAME task (dome-cap): a Partition split them and both concurrently claimed it
// at the same version — view A → R3, view B → R6. On Reconcile the link returns
// and `merge` from crdt.ts lands the single deterministic winner (the lower
// rover id, R3) on BOTH sides — proving order-independent convergence.

import { memo, useCallback, useState } from "react";
import { merge, nextPhase, type PartitionPhase, type TaskRecord } from "../lib/crdt";

// The contested task both rovers claim during the Partition. Same id, same
// version → a genuine concurrent claim the merge must resolve deterministically.
const TASK_ID = "dome-cap";
const CLAIM_VERSION = 4;

// View A's stale local copy: rover R3 holds the lease on dome-cap.
const VIEW_A: TaskRecord = {
  id: TASK_ID,
  status: "LEASED",
  assignee: "R3",
  version: CLAIM_VERSION,
};

// View B's stale local copy: rover R6 holds the same lease, concurrently.
const VIEW_B: TaskRecord = {
  id: TASK_ID,
  status: "LEASED",
  assignee: "R6",
  version: CLAIM_VERSION,
};

// The converged record both sides reconcile to. Computed via the real merge so
// the panel never hard-codes the answer — the lower rover id (R3) wins.
const CONVERGED: TaskRecord = merge(VIEW_A, VIEW_B);

// Human-readable copy per phase, so the eyebrow/caption read as a narrative.
const PHASE_CAPTION: Record<PartitionPhase, string> = {
  PARTITIONED: "link down — each rover works its local World Model; both claimed dome-cap",
  RECONCILING: "link restored — folding both World Models through the proven merge",
  CONVERGED: "order-independent: the lower rover id keeps the lease on both sides",
};

// A single Rover's view of the contested task, rendered as a compact record.
function RoverView({ label, record }: { label: string; record: TaskRecord }) {
  return (
    <div className="partition-view">
      <div className="partition-view-label">{label}</div>
      <div className="partition-task">
        <span className="partition-task-id">{record.id}</span>
        <span className="badge st-leased">{record.status}</span>
        <span className="partition-task-assignee">{record.assignee}</span>
      </div>
    </div>
  );
}

export const PartitionPanel = memo(function PartitionPanel() {
  // The narrative phase is LOCAL UI state only — never world state (ADR-0004).
  const [phase, setPhase] = useState<PartitionPhase>("PARTITIONED");

  // Reconcile drives PARTITIONED → RECONCILING → CONVERGED. RECONCILING is a
  // brief explicit beat (the link returning) before the merge lands, so the
  // evaluator can see the three labels rather than a single jump-cut.
  const reconcile = useCallback(() => {
    setPhase((p) => nextPhase(p));
    // Land on CONVERGED shortly after showing RECONCILING. Pure UI pacing; no
    // world state is touched, so it cannot affect the live snapshot.
    window.setTimeout(() => setPhase((p) => nextPhase(p)), 600);
  }, []);

  // Reset re-arms the narrative so it can be replayed as the encore.
  const reset = useCallback(() => setPhase("PARTITIONED"), []);

  // CONVERGED shows the SAME winning record on both sides; otherwise each side
  // shows its own divergent local copy. Order-independent by construction.
  const converged = phase === "CONVERGED";
  const left = converged ? CONVERGED : VIEW_A;
  const right = converged ? CONVERGED : VIEW_B;

  return (
    <aside className="partition-panel" aria-label="Partition narrative">
      <div className="partition-eyebrow">Partition narrative · stretch</div>

      <div className="partition-phases" role="status" aria-live="polite">
        {(["PARTITIONED", "RECONCILING", "CONVERGED"] as PartitionPhase[]).map((p) => (
          <span
            key={p}
            className={`partition-phase ${phase === p ? "is-active" : ""}`}
            aria-current={phase === p ? "step" : undefined}
          >
            {p}
          </span>
        ))}
      </div>

      <div className="partition-views">
        <RoverView label="Rover view A" record={left} />
        <RoverView label="Rover view B" record={right} />
      </div>

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
    </aside>
  );
});
