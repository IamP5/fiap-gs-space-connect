// BlueprintPalette — the drag-to-place authoring panel (bh-05), top-left under
// the ledger. It lists the pre-authored catalog Blueprints (dome, solar array,
// comms mast). Clicking one STARTS a placement: a ghost preview then follows the
// cursor in the 3D scene showing each Task's Build envelope as a footprint, and
// this panel exposes the rotation control + confirm/cancel. Confirming emits a
// `placeBlueprint{ blueprint_id, origin, rotation }` control; the coordinator
// validates bounds/terrain/no-overlap and injects the DAG, which the Auction
// builds exactly as today.
//
// Placement state is owned by App (App threads it down) — this panel is a pure
// view + dispatcher. The ghost itself is transient client-only state in the
// scene; placed tasks appear via the next snapshot (the scene stays a pure
// function of the snapshot, ADR-0004). Memoized so App's 10 Hz re-render never
// repaints the static catalog.

import { memo, useCallback } from "react";
import { CATALOG } from "../lib/blueprintCatalog";

// Placement is the active drag-to-place interaction, owned by App. `invalidReason`
// is the client-side mirror of the server's bounds/no-overlap gate (null = valid),
// so confirm is disabled and the reason is surfaced when the spot is illegal.
export type Placement = {
  blueprintId: string;
  rotation: number; // radians
  invalidReason: string | null;
};

type Props = {
  placement: Placement | null;
  onStart: (blueprintId: string) => void;
  onRotate: (rotation: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
};

// One full turn of the rotation slider, in radians.
const TWO_PI = Math.PI * 2;

export const BlueprintPalette = memo(function BlueprintPalette({
  placement,
  onStart,
  onRotate,
  onConfirm,
  onCancel,
}: Props) {
  const onRotateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onRotate(Number(e.target.value)),
    [onRotate],
  );

  const active = placement
    ? CATALOG.find((b) => b.id === placement.blueprintId)
    : undefined;

  return (
    <aside className="blueprint-palette" aria-label="Blueprint palette">
      <div className="controls-eyebrow">Blueprints</div>

      <ul className="bp-list">
        {CATALOG.map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className={`bp-item ${placement?.blueprintId === b.id ? "is-active" : ""}`}
              onClick={() => onStart(b.id)}
              aria-pressed={placement?.blueprintId === b.id}
              title={b.description}
            >
              <span className="bp-name">{b.name}</span>
              <span className="bp-desc">{b.description}</span>
            </button>
          </li>
        ))}
      </ul>

      {placement && active ? (
        <div className="bp-placing">
          <p className="bp-hint">
            Move the cursor over the worksite to set <strong>{active.name}</strong>’s spot, then
            confirm.
          </p>

          <div className="control">
            <div className="control-head">
              <label htmlFor="bp-rotation" className="control-label">
                Rotation
              </label>
              <span className="control-value">
                {Math.round((placement.rotation * 180) / Math.PI)}°
              </span>
            </div>
            <input
              id="bp-rotation"
              type="range"
              min={0}
              max={TWO_PI}
              step={TWO_PI / 72}
              value={placement.rotation}
              onChange={onRotateChange}
              className="control-slider"
            />
          </div>

          {placement.invalidReason ? (
            <p className="bp-invalid" role="status">
              ✗ {placement.invalidReason}
            </p>
          ) : (
            <p className="bp-valid" role="status">
              ✓ valid spot
            </p>
          )}

          <div className="bp-actions">
            <button
              type="button"
              className="bp-confirm"
              onClick={onConfirm}
              disabled={placement.invalidReason !== null}
              aria-disabled={placement.invalidReason !== null}
            >
              Place {active.name}
            </button>
            <button type="button" className="bp-cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
});
