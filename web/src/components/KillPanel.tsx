
import { memo } from "react";
import { batteryPercent } from "../lib/format";
import type { RoverView } from "../types/wire";

export const KillPanel = memo(function KillPanel({
  rover,
  onKill,
  onDismiss,
}: {
  rover: RoverView;
  onKill: (id: string) => void;
  onDismiss: () => void;
}) {
  const alive = rover.alive === true;
  return (
    <aside className={`kill-panel ${alive ? "kill-panel-armed" : "kill-panel-down"}`}>
      <div className="kill-eyebrow">Selected rover</div>
      <div className="kill-id">{rover.id.toUpperCase()}</div>
      <div className="kill-stat">
        {alive ? `${batteryPercent(rover.battery)}% battery` : "status down"}
      </div>
      {alive ? (
        <button type="button" className="kill-btn" onClick={() => onKill(rover.id)}>
          KILL
        </button>
      ) : (
        <button type="button" className="kill-btn" disabled>
          DOWN
        </button>
      )}
      <button type="button" className="kill-dismiss" onClick={onDismiss}>
        dismiss
      </button>
    </aside>
  );
});
