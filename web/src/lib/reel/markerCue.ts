// reel/markerCue — the operator-driven Scenery cues on the orbit site markers.
//
// Two cues, both ADDITIVE client-only UI state (the same ADR-0004 carve-out as
// `cinematic`/`copyCursor`): they invent ZERO snapshot/wire fields, read nothing
// from the server, and are gated entirely on the `cinematic` arm flag (#155).
// They only DRIVE marker visuals that already exist (SkyBodies SiteMarker):
//   1. lock-on — force the existing hover lock-on look (corner brackets tighten,
//      line widens) on a chosen marker WITHOUT a mouse hover (Beats 3/6).
//   2. bookend flip — flip the Shackleton marker amber→cyan / "in construction"→
//      "operational" over the closing wide (Beat 15). A Scenery transition: it
//      asserts NO World Model state (markers are Scenery — a marker's status
//      denotes *site established*, NOT dome-complete; the dome's true completion
//      stays in the snapshot-derived MissionHud, CONTEXT.md / grilling outcome 3).
//
// Everything here is pure + DOM-free so it unit-tests in vitest's node env. The
// keybinds it names are the SINGLE source of truth the App's keydown handler
// consumes, so a collision check lives next to them.

// The site markers, in the order the lock-on cue cycles through. Kept here (a
// plain string-union list, NOT importing the component-layer `SiteId`) so the lib
// stays free of any component dependency and unit-tests in node. The App casts the
// result back to its `SiteId` when threading the prop — the unions are identical.
export type MarkerSite = "lunar" | "shackleton";
export const MARKER_CYCLE: readonly MarkerSite[] = ["lunar", "shackleton"];

// ── Marker-cue keybinds ──────────────────────────────────────────────────────
// `m` cycles the lock-on target; `b` toggles the Shackleton bookend flip. Chosen
// to avoid the keys already taken: `r` (arm), `k` (cueKill), `h` (HUD hide),
// `]`/`[` (copy step), `Escape` (cancel placement), `l`/`L` (place while placing).
// Kept next to the data so the App's keydown handler + the test agree on one
// source of truth, and so a future slice sees what's taken at a glance.
//   · lock-on cycle — `m` (mnemonic: marker)
//   · bookend flip  — `b` (mnemonic: bookend)
export const MARKER_LOCKON_KEY = "m";
export const MARKER_FLIP_KEY = "b";

// Step the lock-on target one place along MARKER_CYCLE. `null` = no cue (manual
// hover only). Each `m` press advances null → lunar → shackleton → null, so the
// operator can lock either marker then clear back to the un-cued default. Pure so
// the keybind logic unit-tests without React. Unknown current values reset to the
// first marker (defensive — should never happen).
export function cycleLockOn(
  current: MarkerSite | null,
  cycle: readonly MarkerSite[] = MARKER_CYCLE,
): MarkerSite | null {
  if (current === null) return cycle[0] ?? null;
  const idx = cycle.indexOf(current);
  if (idx === -1) return cycle[0] ?? null;
  // Past the last marker wraps back to the un-cued (null) state.
  return idx + 1 >= cycle.length ? null : cycle[idx + 1];
}

// True iff a keyboard event is the bare lock-on-cycle keystroke (no modifiers, so
// it never hijacks a browser/OS shortcut — mirrors the arm/cue/copy guards). The
// caller gates this on `armed` so a disarmed press is a no-op.
export function isMarkerLockOn(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === MARKER_LOCKON_KEY;
}

// True iff a keyboard event is the bare bookend-flip keystroke (no modifiers).
// The caller gates this on `armed` and toggles its flip flag on a true return.
export function isMarkerFlip(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === MARKER_FLIP_KEY;
}
