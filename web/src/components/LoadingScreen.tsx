// LoadingScreen — the branded SwarmBuild splash shown while EVERY asset preloads
// behind it, so nothing pops in later (even on the descent). Epic 05 P1.
//
// PRESENTATIONAL: App owns the preload kickoff (a DYNAMIC import of lib/assets, so
// the three.js-pulling manifest never lands in the lightweight shell bundle) and
// feeds this component a deterministic `progress` (0..1, from preloadAllAssets's
// onProgress — NOT drei useProgress, which hits a 0/0-is-100 first-frame race) plus
// a one-way `revealed` latch. When `revealed` flips true the overlay fades out via
// CSS opacity, then unmounts. The latch is one-way (App never flips it back), so the
// splash NEVER re-shows on later on-demand loads.
//
// ADR-0004: the reveal is driven by App's preload-resolved-OR-safety-timeout latch,
// so a hung/missing asset can never trap the user behind the splash.

import { useEffect, useState } from "react";

// How long the opacity fade runs before we unmount the overlay. Matches the CSS
// transition on .loading-screen.
const FADE_MS = 600;

export function LoadingScreen({
  progress,
  revealed,
}: {
  progress: number; // 0..1 deterministic preload progress
  revealed: boolean; // one-way reveal latch (App-owned)
}) {
  // After the reveal fade completes we unmount the overlay entirely so it never
  // intercepts pointer events over the live scene.
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
