
import { memo, useCallback, useState } from "react";
import { CATALOG } from "../lib/blueprintCatalog";
import { footprintGlyph } from "../lib/footprintGlyph";
import { StressControls, type StressDial } from "./StressControls";
import type { Control } from "../types/wire";
import type { SiteId } from "./Scene3D";

const SITE_LABEL: Record<SiteId, string> = {
  lunar: "Lunar Base",
  shackleton: "Shackleton",
};

const SiteGlyph = memo(function SiteGlyph() {
  return (
    <svg className="hotbar-chip-glyph" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8 Z" />
      <circle cx="8" cy="8" r="1.7" />
    </svg>
  );
});

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
  activeSite,
  onCycleSite,
  send,
}: {
  activeBlueprintId: string | null;
  onPickBlueprint: (blueprintId: string) => void;
  activeSite: SiteId;
  onCycleSite: () => void;
  send: (c: Control) => void;
}) {
  const [openPopover, setOpenPopover] = useState<StressDial | null>(null);

  const togglePopover = useCallback(
    (dial: StressDial) => setOpenPopover((cur) => (cur === dial ? null : dial)),
    [],
  );

  return (
    <div className="hotbar hud-surface-panel" role="toolbar" aria-label="Build hotbar">
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
