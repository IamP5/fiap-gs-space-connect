// Hotbar — the unified game-style bottom bar on the SURFACE view (Epic 06 P1).
// It replaces the old text-card BlueprintPalette + the bottom-left stress slider
// panel + the per-placement Replay/Live toggle + the ControlsPanel site toggle,
// folding them into one bottom-centre bar:
//
//   [ footprint-glyph blueprint icons ] | [ ☐ LLM Generated ] | [ ⚠ ⏱ ] | [ 📍 site ]
//
// - Each blueprint icon's glyph is a top-down FOOTPRINT schematic generated from
//   that blueprint's REAL catalog `rel` positions + envelope sizes (footprintGlyph),
//   so you see what you're about to drop. Clicking arms a placement (same path the
//   old palette used: App.startPlacement → ghost follows cursor in Scene3D).
// - "LLM Generated" is a PERSISTENT checkbox (default off = Replay). App owns the
//   `liveMode` flag; when a placement starts App seeds `placement.mode` from it, so
//   the existing `mode` field on the placeBlueprint control is threaded with NO
//   wire change.
// - ⚠ Failure / ⏱ Latency are icon buttons that pop a slider popover ABOVE the bar
//   (StressControls, sending the SAME setFailureProb/setLatency frames).
// - 📍 chip shows + cycles the active site (Lunar ↔ Shackleton), triggering the
//   existing site re-descent.
//
// Purely presentational + memoized (only a local `openPopover` UI flag); App owns
// every real piece of state and threads it in, so the 10 Hz snapshot re-render
// never repaints the bar.

import { memo, useCallback, useState } from "react";
import { CATALOG } from "../lib/blueprintCatalog";
import { footprintGlyph } from "../lib/footprintGlyph";
import { StressControls, type StressDial } from "./StressControls";
import type { Control } from "../types/wire";
// Type-only import — erased at build time, so this does NOT pull the lazy
// three.js Scene3D chunk into the eager dashboard bundle.
import type { SiteId } from "./Scene3D";

const SITE_LABEL: Record<SiteId, string> = {
  lunar: "Lunar Base",
  shackleton: "Shackleton",
};

// SiteGlyph — a small in-world-style line-diamond with a centre dot, echoing the
// NMS orbit-marker reticle. Colour is driven by CSS (currentColor via --chip-tint),
// so the same glyph reads cyan for Lunar / amber for Shackleton.
const SiteGlyph = memo(function SiteGlyph() {
  return (
    <svg className="hotbar-chip-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" />
      <circle cx="8" cy="8" r="1.7" />
    </svg>
  );
});

// FootprintIcon renders one blueprint's top-down schematic as an inline SVG. The
// glyph geometry is pure (footprintGlyph); here we just paint each projected cell
// as a <rect> (rounded into a dot when small), tinted via the --hud-accent token.
const FootprintIcon = memo(function FootprintIcon({ blueprintId }: { blueprintId: string }) {
  const bp = CATALOG.find((b) => b.id === blueprintId);
  if (!bp) return null;
  const glyph = footprintGlyph(bp);
  return (
    <svg
      className="hotbar-glyph"
      viewBox={`0 0 ${glyph.viewBox} ${glyph.viewBox}`}
      aria-hidden="true"
      focusable="false"
    >
      {glyph.rects.map((r) => (
        <rect
          key={r.id}
          x={r.cx - r.halfX}
          y={r.cy - r.halfY}
          width={r.halfX * 2}
          height={r.halfY * 2}
          rx={r.round ? Math.min(r.halfX, r.halfY) : 2}
          ry={r.round ? Math.min(r.halfX, r.halfY) : 2}
        />
      ))}
    </svg>
  );
});

export const Hotbar = memo(function Hotbar({
  activeBlueprintId,
  onPickBlueprint,
  liveMode,
  onLiveModeChange,
  activeSite,
  onCycleSite,
  send,
}: {
  // The blueprint currently being placed (so its icon reads as armed), or null.
  activeBlueprintId: string | null;
  // Arm a placement for this blueprint (App.startPlacement). Re-picking the active
  // one cancels — App already handles that toggle.
  onPickBlueprint: (blueprintId: string) => void;
  // Persistent "LLM Generated" toggle (App-owned). false = Replay, true = Live.
  liveMode: boolean;
  onLiveModeChange: (live: boolean) => void;
  // The surface site chip: shows the current site, click cycles it (re-descent).
  activeSite: SiteId;
  onCycleSite: () => void;
  // Control sink for the stress popovers (setFailureProb / setLatency).
  send: (c: Control) => void;
}) {
  // Which stress popover is open (only one at a time), or null. Local UI flag.
  const [openPopover, setOpenPopover] = useState<StressDial | null>(null);

  const togglePopover = useCallback(
    (dial: StressDial) => setOpenPopover((cur) => (cur === dial ? null : dial)),
    [],
  );

  const onLiveToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onLiveModeChange(e.target.checked),
    [onLiveModeChange],
  );

  return (
    <div className="hotbar hud-surface-panel" role="toolbar" aria-label="Build hotbar">
      {/* Blueprint glyphs: footprint schematics generated from the catalog. */}
      <div className="hotbar-group hotbar-blueprints" role="group" aria-label="Blueprints">
        {CATALOG.map((b) => {
          const armed = activeBlueprintId === b.id;
          return (
            <button
              key={b.id}
              type="button"
              className={`hotbar-slot ${armed ? "is-active" : ""}`}
              onClick={() => onPickBlueprint(b.id)}
              aria-pressed={armed}
              title={`${b.name} — ${b.description}`}
            >
              <FootprintIcon blueprintId={b.id} />
              <span className="hotbar-slot-name">{b.name}</span>
            </button>
          );
        })}
      </div>

      <div className="hotbar-sep" aria-hidden="true" />

      {/* Persistent LLM-Generated toggle (default off = Replay). No checkbox
          chrome — the label itself is the switch (a status dot + frosted-cyan
          fill on select, styled via :has(input:checked)). The native input is
          kept, visually hidden, for keyboard + screen-reader access. Threads
          mode into the placeBlueprint control via App's liveMode seed. */}
      <label
        className="hotbar-toggle"
        title="Generate the next structure live via the Build harness (default: deterministic replay)"
      >
        <input type="checkbox" checked={liveMode} onChange={onLiveToggle} />
        <span>LLM Generated</span>
      </label>

      <div className="hotbar-sep" aria-hidden="true" />

      {/* Stress popovers — ⚠ Failure + ⏱ Latency. Each toggles a slider popover
          ABOVE the bar; the slider sends the same control frames as before. */}
      <div className="hotbar-group hotbar-stress" role="group" aria-label="Stress controls">
        <div className="hotbar-popover-anchor">
          {openPopover === "failure" ? (
            <div className="hotbar-popover panel" role="dialog" aria-label="Failure control">
              <StressControls which="failure" send={send} />
            </div>
          ) : null}
          <button
            type="button"
            className={`hotbar-icon ${openPopover === "failure" ? "is-active" : ""}`}
            onClick={() => togglePopover("failure")}
            aria-pressed={openPopover === "failure"}
            aria-label="Failure"
            title="Failure — induce random rover failures"
          >
            <span className="hotbar-icon-glyph" aria-hidden="true">⚠</span>
            <span className="hotbar-icon-label">Failure</span>
          </button>
        </div>

        <div className="hotbar-popover-anchor">
          {openPopover === "latency" ? (
            <div className="hotbar-popover panel" role="dialog" aria-label="Latency control">
              <StressControls which="latency" send={send} />
            </div>
          ) : null}
          <button
            type="button"
            className={`hotbar-icon ${openPopover === "latency" ? "is-active" : ""}`}
            onClick={() => togglePopover("latency")}
            aria-pressed={openPopover === "latency"}
            aria-label="Latency"
            title="Latency — delay the Earth uplink"
          >
            <span className="hotbar-icon-glyph" aria-hidden="true">⏱</span>
            <span className="hotbar-icon-label">Latency</span>
          </button>
        </div>
      </div>

      <div className="hotbar-sep" aria-hidden="true" />

      {/* Site chip — shows + cycles the active surface site (re-descent). The
          line-diamond glyph + chip tint key off the site (cyan/amber), tying it
          to the in-world NMS markers. */}
      <button
        type="button"
        className={`hotbar-chip ${activeSite === "shackleton" ? "is-shackleton" : ""}`}
        onClick={onCycleSite}
        title="Switch worksite (re-descends to the other site)"
      >
        <SiteGlyph />
        <span className="hotbar-chip-label">{SITE_LABEL[activeSite]}</span>
      </button>
    </div>
  );
});
