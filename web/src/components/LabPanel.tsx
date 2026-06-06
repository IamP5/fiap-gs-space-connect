// LabPanel — the in-app LIVE "lab" surface (bh-07a): pick a catalog Task type,
// click "Generate live", and watch the REAL Generator↔Evaluator loop think in an
// agent console that streams each emitted Build spec and the Evaluator's
// per-iteration verdict (hard gate + soft rubric + evidence) as they happen.
//
// This is explicitly OFF the headline: the console feed is a SEPARATE channel
// (gateway /lab/generate SSE), never the world Snapshot — so it can never pre-empt
// or contradict the live heal (ADR-0004). It is an opt-in, collapsible dock card
// like the Encore/Partition panels. Memoized: it owns its own lab state and never
// repaints on the 10 Hz snapshot.

import { memo, useCallback, useState } from "react";
import { useLab } from "../hooks/useLab";
import { type LabEvent, verdictPassed, verdictSummary } from "../lib/lab";

// The selectable Task types — mirrors the backend lab.Catalog() (the dome
// blueprint's three kinds). Kept static so the dropdown needs no extra fetch.
const CATALOG: Array<{ type: string; label: string }> = [
  { type: "foundation", label: "Foundation (plinth)" },
  { type: "wall", label: "Wall segment" },
  { type: "dome-cap", label: "Dome cap (keystone)" },
];

// A single console line per event, rendered from the streamed LabEvent.
function ConsoleLine({ e }: { e: LabEvent }) {
  switch (e.kind) {
    case "started":
      return (
        <li className="lab-line lab-line-started">
          <span className="lab-tag">start</span>
          building <strong>{e.task_type}</strong> · {e.provider}/{e.model}
        </li>
      );
    case "ops":
      return (
        <li className="lab-line lab-line-ops">
          <span className="lab-tag">gen #{e.iter}</span>
          emitted <strong>{e.ops?.length ?? 0}</strong> build op(s)
          {e.ops && e.ops.length > 0 ? (
            <span className="lab-ops-shapes">
              {" "}
              [{e.ops.map((o) => o.shape).join(", ")}]
            </span>
          ) : null}
        </li>
      );
    case "verdict": {
      const failed = !verdictPassed(e);
      return (
        <li className={`lab-line lab-line-verdict ${failed ? "is-fail" : "is-pass"}`}>
          <span className="lab-tag">eval #{e.iter}</span>
          {verdictSummary(e)}
          {failed && e.reasons && e.reasons.length > 0 ? (
            <span className="lab-reasons"> — {e.reasons.join("; ")}</span>
          ) : null}
          {e.verdict ? (
            <span className="lab-evidence">
              {" "}
              · coverage: {e.verdict.rubric.done_coverage.evidence}; coherence:{" "}
              {e.verdict.rubric.coherence.evidence}
            </span>
          ) : null}
        </li>
      );
    }
    case "done":
      return (
        <li className={`lab-line lab-line-done ${e.result === "fallback" ? "is-fail" : "is-pass"}`}>
          <span className="lab-tag">done</span>
          {e.result === "accepted" ? "accepted" : "fallback"}
          {e.quality_flag ? ` · quality:${e.quality_flag}` : ""} — {e.reason}
        </li>
      );
    case "error":
      return (
        <li className="lab-line lab-line-error">
          <span className="lab-tag">error</span>
          {e.reason}
        </li>
      );
    default:
      return null;
  }
}

export const LabPanel = memo(function LabPanel() {
  const [open, setOpen] = useState(false);
  const [taskType, setTaskType] = useState(CATALOG[0].type);
  const { events, running, error, generate } = useLab();

  const toggle = useCallback(() => setOpen((o) => !o), []);
  const onGenerate = useCallback(() => generate(taskType), [generate, taskType]);

  return (
    <aside className="lab-card lab-panel" data-open={open} aria-label="Live generation lab">
      <button type="button" className="lab-head" onClick={toggle} aria-expanded={open}>
        <span>Lab · live generation</span>
        <span className="lab-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="lab-body">
          <p className="lab-caption">
            Runs the REAL Generator↔Evaluator loop (live model call) for one catalog Task and
            streams every spec + verdict below. Off the headline — the world heals independently.
          </p>

          <div className="lab-controls">
            <label htmlFor="lab-task" className="lab-control-label">
              Task
            </label>
            <select
              id="lab-task"
              className="lab-select"
              value={taskType}
              onChange={(ev) => setTaskType(ev.target.value)}
              disabled={running}
            >
              {CATALOG.map((c) => (
                <option key={c.type} value={c.type}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="lab-generate-btn"
              onClick={onGenerate}
              disabled={running}
              aria-busy={running}
            >
              {running ? "Generating…" : "Generate live"}
            </button>
          </div>

          {error ? <p className="lab-error">{error}</p> : null}

          {/* The agent console — the "watch it think" surface. */}
          <ol className="lab-console" aria-live="polite" aria-label="Agent console">
            {events.length === 0 && !running ? (
              <li className="lab-line lab-line-idle">No run yet. Pick a Task and Generate live.</li>
            ) : (
              events.map((e, i) => <ConsoleLine key={i} e={e} />)
            )}
          </ol>
        </div>
      )}
    </aside>
  );
});
