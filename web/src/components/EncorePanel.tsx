// EncorePanel — the container-encore trigger (issue 11), an explicitly opt-in
// affordance for AFTER the headline in-proc kill has landed (ADR-0001).
//
// The headline kill flag-flips an in-process rover dead. The ENCORE goes one
// step further: it fails a rover that is a genuinely separate running system —
// a real Docker container — over the real bus. This button sends the control
// frame { cmd: "killContainer", robot: "R7" }; the gateway relays it onto NATS
// and a killer sidecar does the real `docker kill`. The swarm then self-heals
// exactly as it does for the in-proc kill: Expiry → Re-auction → Self-heal.
//
// Two-step / guarded like KillPanel, so a stray click never fells a container:
// the operator must ARM the encore, then confirm. Memoized on its single stable
// prop (`send`), so App's 10 Hz snapshot re-render never repaints it.

import { memo, useCallback, useState } from "react";
import type { Control } from "../types/wire";

// R7 is the encore rover — the one hosted as a real container, distinct from the
// in-proc rovers the headline kill fells (shared contract with backend-encore).
const ENCORE_ROVER = "R7";

export const EncorePanel = memo(function EncorePanel({
  send,
}: {
  send: (c: Control) => void;
}) {
  // armed is local UI state only — the two-step guard, not world state.
  const [armed, setArmed] = useState(false);

  const arm = useCallback(() => setArmed(true), []);
  const cancel = useCallback(() => setArmed(false), []);

  const fire = useCallback(() => {
    // Browser → server control frame; the gateway relays it onto NATS and the
    // killer sidecar runs `docker kill R7`. This fails a REAL rover container —
    // the swarm heals on its own (Expiry → Re-auction → Self-heal).
    send({ cmd: "killContainer", robot: ENCORE_ROVER });
    setArmed(false);
  }, [send]);

  return (
    <aside className="encore-panel" aria-label="Container encore">
      <div className="encore-eyebrow">Encore · real container</div>
      <p className="encore-caption">
        Fails rover {ENCORE_ROVER} as a separate running container over the real bus — the
        swarm self-heals (Expiry → Re-auction → Self-heal). Run it AFTER the headline kill.
      </p>

      {armed ? (
        <div className="encore-confirm">
          <button
            type="button"
            className="encore-btn encore-btn-fire"
            onClick={fire}
            autoFocus
          >
            docker kill {ENCORE_ROVER} (encore)
          </button>
          <button type="button" className="encore-cancel" onClick={cancel}>
            cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="encore-btn"
          onClick={arm}
          aria-pressed={false}
        >
          Arm encore
        </button>
      )}
    </aside>
  );
});
