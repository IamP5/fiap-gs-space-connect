// StatusIndicator — the header "all systems connected" dot + label.
//
// A thin presentational shell over the pure connectionStatus() derivation.
// Memoized so the 10 Hz snapshot re-render of App only repaints it when the
// derived status actually changes (the dot is otherwise stable for long
// stretches).

import { memo } from "react";
import type { ConnectionStatus } from "../lib/connection";

export const StatusIndicator = memo(function StatusIndicator({
  status,
}: {
  status: ConnectionStatus;
}) {
  return (
    <div className={`status status-${status.kind}`}>
      <span className="status-dot" />
      <span className="status-label">{status.label}</span>
    </div>
  );
});
