
import { useEffect, useState } from "react";

const FADE_MS = 600;

export function LoadingScreen({
  progress,
  revealed,
}: {
  progress: number;
  revealed: boolean;
}) {
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!revealed) return;
    const t = window.setTimeout(() => setMounted(false), FADE_MS);
    return () => window.clearTimeout(t);
  }, [revealed]);

  if (!mounted) return null;

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div
      className={`loading-screen${revealed ? " loading-screen--revealed" : ""}`}
      role="progressbar"
      aria-label="Loading the lunar scene"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-hidden={revealed}
    >
      <div className="loading-screen__brand">
        SwarmBuild <span className="loading-screen__brand-sub">dashboard</span>
      </div>
      <div className="loading-screen__bar">
        <div className="loading-screen__fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="loading-screen__status">
        Preparing the lunar worksite… {pct}%
      </div>
    </div>
  );
}
