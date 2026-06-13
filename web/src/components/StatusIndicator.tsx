
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
