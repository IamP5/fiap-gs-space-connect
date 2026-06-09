// TopBar — the slim, always-on HUD strip shown in BOTH views (Epic 06 P0).
//
// In ORBIT it is the ONLY HUD: wordmark · connection status pill · a
// Surface/Orbit segmented toggle (lifted out of ControlsPanel). The raw ws://
// URL is dropped from view and survives only as a hover tooltip on the status
// pill. Purely presentational — App owns every piece of state (viewMode, status)
// and threads it in. Memoized so App's 10 Hz snapshot re-render only repaints the
// bar when one of these stable props actually changes.

import { memo } from "react";
import type { ConnectionStatus } from "../lib/connection";
import { StatusIndicator } from "./StatusIndicator";
// Type-only import — erased at build time, so this does NOT pull the lazy
// three.js Scene3D chunk into the eager dashboard bundle.
import type { ViewMode } from "./Scene3D";

export const TopBar = memo(function TopBar({
  status,
  url,
  viewMode,
  onViewModeChange,
}: {
  status: ConnectionStatus;
  // The live ws:// endpoint — shown only as a tooltip on the connection pill,
  // never as visible chrome (Epic 06 P0: drop the raw URL from view).
  url: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">SwarmBuild</div>

      {/* Connection pill — the ws:// URL lives here as a tooltip only. */}
      <div className="topbar-pill" title={url}>
        <StatusIndicator status={status} />
      </div>

      {/* Camera view-mode toggle (issue #49), lifted out of ControlsPanel into
          the top bar (Epic 06 P0): surface = rehearsed worksite framing; orbit =
          the Moon space-vista. Toggling plays a glare-masked descent. */}
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
