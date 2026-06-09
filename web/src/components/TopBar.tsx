
import { memo } from "react";
import type { ConnectionStatus } from "../lib/connection";
import { StatusIndicator } from "./StatusIndicator";
import type { ViewMode } from "./Scene3D";

export const TopBar = memo(function TopBar({
  status,
  url,
  viewMode,
  onViewModeChange,
}: {
  status: ConnectionStatus;
  url: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">SwarmBuild</div>

      <div className="topbar-pill" title={url}>
        <StatusIndicator status={status} />
      </div>

      <div className="view-toggle topbar-view" role="group" aria-label="Camera view">
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
    </header>
  );
});
