// ControlsPanel — the operator's two stress dials (issues 08 + 09), bottom-left.
//
// These sliders are OPERATOR INPUTS, not World Model state, so the panel owns
// their positions as local UI state — the dashboard stays a pure re-render of
// the *snapshot* (ADR-0004); these are controls, not derived state. Each change
// sends a control frame the gateway relays onto NATS:
//   · failure → { cmd: "setFailureProb", value }  (0..1 per-rover fail rate; 0 = OFF)
//   · latency → { cmd: "setLatency",     value }  (ms of delay on earth.uplink ONLY)
// Memoized on its single stable prop (`send`), so App's 10 Hz snapshot re-render
// never repaints the sliders.

import { memo, useCallback, useState } from "react";
import type { Control } from "../types/wire";
// Type-only import — erased at build time, so this does NOT pull the lazy
// three.js Scene3D chunk into the eager dashboard bundle.
import type { ViewMode } from "./Scene3D";

const FAILURE_MAX = 1;
const FAILURE_STEP = 0.05;
const LATENCY_MAX = 3000;
const LATENCY_STEP = 100;

export const ControlsPanel = memo(function ControlsPanel({
  send,
  viewMode,
  onViewModeChange,
}: {
  send: (c: Control) => void;
  // Camera view-mode toggle (issue #49). Threaded from App; the 3D scene reads
  // it as a prop.
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  // Local UI state for the dial positions — operator inputs, not world state.
  const [failure, setFailure] = useState(0);
  const [latency, setLatency] = useState(0);

  const onFailure = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setFailure(value);
      // 0 stops induced failures (issue 08); the backend treats 0 as OFF.
      send({ cmd: "setFailureProb", value });
    },
    [send],
  );

  const onLatency = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setLatency(value);
      // Delays the earth.uplink feed ONLY — the swarm heals at full speed.
      send({ cmd: "setLatency", value });
    },
    [send],
  );

  const failurePct = Math.round(failure * 100);

  return (
    <aside className="controls-panel">
      <div className="controls-eyebrow">Stress controls</div>

      {/* Camera view-mode toggle (issue #49): surface = rehearsed worksite
          framing (default, ADR-0004); orbit = the Moon space-vista (worksite
          hidden). Toggling plays a glare-masked descent between them. Clamped. */}
      <div className="control">
        <div className="control-head">
          <span className="control-label">View</span>
        </div>
        <div className="view-toggle" role="group" aria-label="Camera view">
          <button
            type="button"
            className={`view-btn ${viewMode === "surface" ? "is-active" : ""}`}
            aria-pressed={viewMode === "surface"}
            onClick={() => onViewModeChange("surface")}
          >
            Surface
          </button>
          <button
            type="button"
            className={`view-btn ${viewMode === "orbit" ? "is-active" : ""}`}
            aria-pressed={viewMode === "orbit"}
            onClick={() => onViewModeChange("orbit")}
          >
            Orbit
          </button>
        </div>
        <p className="control-caption">
          surface worksite · orbit flies up to the Moon vista
        </p>
      </div>

      <div className="control">
        <div className="control-head">
          <label htmlFor="failure-slider" className="control-label">
            Failure
          </label>
          <span className={`control-value ${failurePct > 0 ? "is-live" : ""}`}>
            {failurePct === 0 ? "OFF" : `${failurePct}%`}
          </span>
        </div>
        <input
          id="failure-slider"
          type="range"
          min={0}
          max={FAILURE_MAX}
          step={FAILURE_STEP}
          value={failure}
          onChange={onFailure}
          className="control-slider"
        />
        <p className="control-caption">random rover failures · self-heal under stress</p>
      </div>

      <div className="control">
        <div className="control-head">
          <label htmlFor="latency-slider" className="control-label">
            Latency
          </label>
          <span className={`control-value ${latency > 0 ? "is-live" : ""}`}>
            {latency === 0 ? "0 ms" : `${latency} ms`}
          </span>
        </div>
        <input
          id="latency-slider"
          type="range"
          min={0}
          max={LATENCY_MAX}
          step={LATENCY_STEP}
          value={latency}
          onChange={onLatency}
          className="control-slider"
        />
        <p className="control-caption">
          delays earth.uplink only — the swarm heals at full speed
        </p>
      </div>
    </aside>
  );
});
