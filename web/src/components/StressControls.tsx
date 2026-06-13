
import { memo, useCallback, useState } from "react";
import type { Control } from "../types/wire";

const FAILURE_MAX = 1;
const FAILURE_STEP = 0.05;
const LATENCY_MAX = 3000;
const LATENCY_STEP = 100;

export type StressDial = "failure" | "latency";

export const StressControls = memo(function StressControls({
  which,
  send,
}: {
  which: StressDial;
  send: (c: Control) => void;
}) {
  const [failure, setFailure] = useState(0);
  const [latency, setLatency] = useState(0);

  const onFailure = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setFailure(value);
      send({ cmd: "setFailureProb", value });
    },
    [send],
  );

  const onLatency = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value);
      setLatency(value);
      send({ cmd: "setLatency", value });
    },
    [send],
  );

  const failurePct = Math.round(failure * 100);

  if (which === "failure") {
    return (
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
    );
  }

  return (
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
  );
});
