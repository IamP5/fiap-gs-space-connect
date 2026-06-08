// CinematicCopy — the burned-in PT-BR copy overlay for the Epic 07 demo (#156).
//
// Scenery (non-diegetic): it encodes ZERO World Model state. It renders the
// script §6 copy beats (lib/reel/copy) one at a time, advanced by the operator's
// `]`/`[` keybind (the cursor lives in App, which owns the single keydown
// listener — #155's pattern). It invents no snapshot/wire fields (ADR-0004).
//
// CRUCIAL placement: App mounts this as a SIBLING of `.hud-stage`, NOT a child.
// The `H` cinematic HUD-fade adds `hud--hidden` to `.hud-stage` and fades the
// floating panels; because this overlay lives OUTSIDE that wrapper, the bookend
// wordmark/CTA survives `H` and holds over the pure orbit vista (Beats 14–15).
//
// It is pointer-inert (decorative burn-in over the live scene), full-bleed, and
// centred. Each beat's `variant` gets a distinct class (reel.css) so wordmark /
// stake / objective / card / thesis / cta read differently. `cursor` is the index
// into COPY_BEATS; -1 (or out of range) ⇒ a clean stage (nothing rendered).
// Re-keyed on the beat id so a CSS fade-in replays as the operator advances.

import { memo } from "react";
import { COPY_BEATS } from "../lib/reel/copy";
import "../styles/reel.css";

interface CinematicCopyProps {
  // Index into COPY_BEATS of the line to show; -1 = clean stage (nothing shown).
  cursor: number;
}

export const CinematicCopy = memo(function CinematicCopy({
  cursor,
}: CinematicCopyProps) {
  const beat = cursor >= 0 ? COPY_BEATS[cursor] : undefined;
  if (!beat) return null;

  return (
    <div className="reel-copy" role="presentation" aria-hidden="true">
      {/* Re-key on the beat id so the fade-in transition replays per advance. */}
      <div
        key={beat.id}
        className={`reel-copy__beat reel-copy__beat--${beat.variant}`}
      >
        {beat.lines.map((line, i) => (
          <p key={i} className="reel-copy__line">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
});
