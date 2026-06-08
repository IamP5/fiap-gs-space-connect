// cinematicArm — pure, DOM-free helpers for the Epic 07 cinematic "arm" flag.
//
// Cinematic arming is ADDITIVE client UI state (the same ADR-0004 carve-out as
// `selected`/`hudHidden`): it invents ZERO snapshot/wire fields. When DISARMED
// every cue handler is a no-op, so the normal app is byte-for-byte unchanged.
//
// The flag has two entry points (IMPLEMENTATION-PLAN Slice 6 "Arming"):
//   1. the `?reel=1` URL param sets the INITIAL armed state on load, and
//   2. a keybind toggles it live during a take.
// `?reel=1` / "reel" are just capture-tooling tokens (NOT a new domain concept);
// the domain layer is "interactive Choreography" (operator-paced) — see
// CONTEXT.md + ADR-0011.
//
// Everything here is pure so it unit-tests in vitest's node env (no DOM clock,
// no React). The keybinds it names are the SINGLE source of truth the App's
// window keydown handler consumes, so a collision check lives next to them.

// The keys this slice binds. Kept here (not inline in App) so the test and the
// handler agree, and so a future slice can see what's already taken at a glance.
//   · arm toggle  — `r` (mnemonic: reel; lower/upper, no modifiers)
//   · cue: kill   — `k` (mnemonic: kill; armed-only, the money shot)
// Existing app keybinds these MUST NOT collide with: `h` (HUD hide), `Escape`
// (cancel placement); `l`/`L` are scene-local (place) but only while placing.
export const ARM_TOGGLE_KEY = "r";
export const CUE_KILL_KEY = "k";

// Read the initial armed state from a URL query string. Armed iff `reel=1`.
// Accepts a raw search string ("?reel=1" or "reel=1") so it's trivially testable
// without a `window`. Any other value (absent, "0", "true", …) ⇒ disarmed: we
// keep the contract narrow so the normal app stays unchanged unless explicitly
// opted in.
export function armedFromSearch(search: string): boolean {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("reel") === "1";
}

// True iff a keyboard event is the bare arm-toggle keystroke (no modifiers).
// Modifier combos (⌘/Ctrl/Alt) are excluded so the key never hijacks a browser
// or OS shortcut — mirrors the existing `H` handler's guard.
export function isArmToggle(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === ARM_TOGGLE_KEY;
}

// True iff a keyboard event is the bare cue-kill keystroke (no modifiers).
// The caller gates this on `armed` so a disarmed press is a no-op.
export function isCueKill(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  return e.key.toLowerCase() === CUE_KILL_KEY;
}

// True iff a keydown originated in a text-entry context, where our global
// shortcuts must yield so they never hijack typing. Mirrors the `H` handler's
// tag check. `target` is the event target (typed loosely so the pure fn needs no
// DOM lib).
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable === true;
}
