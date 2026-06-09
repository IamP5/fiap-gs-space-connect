// LunarBaseDecals — flat ground decals that anchor the lunar base zones to the
// regolith (Milestone 08, WS-2). They sell a PREPARED, lived-in base: a darker
// compacted-regolith grading disc under each cluster, plus faint wheel tracks
// stitching the zones together. Without them the set-pieces read as props
// floating on raw dirt; with them they read as built on a graded site.
//
// Pure decoration, snapshot-INDEPENDENT (ADR-0004): the layout lives as pure data
// in lib/scene (LUNAR_BASE_PADS / LUNAR_ROVER_TRACKS) so it is unit-testable, and
// this component is a thin map onto flat planes. Both kinds are raycast-suppressed
// so the only pickable surface stays each rover's hit-proxy (ADR-0004 / #48), and
// both use the same procedural CanvasTexture technique as ShackletonShadows (no
// manifest asset ⇒ nothing to fail/pop-in on descent). Textures build once and
// dispose on unmount.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  LUNAR_BASE_PADS,
  LUNAR_ROVER_TRACKS,
} from "../lib/scene";

// A soft radial-gradient disc: darker, flatter compacted regolith at the centre,
// fading transparent at the rim so it never reads as a hard ring on the ground.
function makePadTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Dark compacted centre easing to nothing — a graded, swept-clear pad.
  g.addColorStop(0, "rgba(0,0,0,0.42)");
  g.addColorStop(0.7, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Two parallel wheel ruts running along U (the track's length), soft-edged across
// V and faded at both ends so a track blends into the regolith rather than
// stopping abruptly. Maps onto a stretched plane between two zones.
function makeTrackTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const w = 128;
  const h = 32;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  // Lengthwise fade (transparent → solid → transparent) so the ends dissolve.
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.15, "rgba(0,0,0,1)");
  fade.addColorStop(0.85, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  // Two ruts at ~1/3 and ~2/3 across the width.
  for (const cy of [h * 0.34, h * 0.66]) {
    const rut = ctx.createLinearGradient(0, cy - 4, 0, cy + 4);
    rut.addColorStop(0, "rgba(0,0,0,0)");
    rut.addColorStop(0.5, "rgba(0,0,0,0.5)");
    rut.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = rut;
    ctx.fillRect(0, cy - 4, w, 8);
    ctx.restore();
  }
  // Multiply the lengthwise fade over the ruts so the ends taper.
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function LunarBaseDecals() {
  const padTex = useMemo(makePadTexture, []);
  const trackTex = useMemo(makeTrackTexture, []);
  useEffect(() => () => padTex?.dispose(), [padTex]);
  useEffect(() => () => trackTex?.dispose(), [trackTex]);

  // Precompute each track's midpoint, heading, and length from its endpoints.
  const tracks = useMemo(
    () =>
      LUNAR_ROVER_TRACKS.map((t) => {
        const dx = t.to[0] - t.from[0];
        const dz = t.to[1] - t.from[1];
        const len = Math.hypot(dx, dz);
        const heading = Math.atan2(dz, dx); // around +y, in the x/z plane
        const mx = (t.from[0] + t.to[0]) / 2;
        const mz = (t.from[1] + t.to[1]) / 2;
        return { mx, mz, len, heading, width: t.width };
      }),
    [],
  );

  if (!padTex || !trackTex) return null;

  return (
    <group>
      {/* Graded compacted-regolith pads under each zone cluster. Flat on the
          ground (rotateX −90°), a hair above y=0 to avoid z-fighting the terrain. */}
      {LUNAR_BASE_PADS.map((p, i) => (
        <mesh
          key={`pad-${i}`}
          position={[p.center[0], 0.02, p.center[1]]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={[p.radius * 2, p.radius * 2, 1]}
          raycast={() => null}
          renderOrder={1}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={padTex}
            transparent
            opacity={0.85}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* Wheel tracks between zones. The plane's local +x is the track length, so
          yaw by −heading after laying it flat. Sits a touch above the pads. */}
      {tracks.map((t, i) => (
        <mesh
          key={`track-${i}`}
          position={[t.mx, 0.025, t.mz]}
          rotation={[-Math.PI / 2, 0, -t.heading]}
          scale={[t.len, t.width, 1]}
          raycast={() => null}
          renderOrder={2}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={trackTex}
            transparent
            opacity={0.5}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
