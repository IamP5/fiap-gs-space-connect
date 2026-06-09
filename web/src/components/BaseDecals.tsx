
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  LUNAR_BASE_PADS,
  LUNAR_ROVER_TRACKS,
} from "../lib/scene";

function makePadTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const size = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(0,0,0,0.42)");
  g.addColorStop(0.7, "rgba(0,0,0,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeTrackTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const w = 128;
  const h = 32;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const fade = ctx.createLinearGradient(0, 0, w, 0);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(0.15, "rgba(0,0,0,1)");
  fade.addColorStop(0.85, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
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

  const tracks = useMemo(
    () =>
      LUNAR_ROVER_TRACKS.map((t) => {
        const dx = t.to[0] - t.from[0];
        const dz = t.to[1] - t.from[1];
        const len = Math.hypot(dx, dz);
        const heading = Math.atan2(dz, dx);
        const mx = (t.from[0] + t.to[0]) / 2;
        const mz = (t.from[1] + t.to[1]) / 2;
        return { mx, mz, len, heading, width: t.width };
      }),
    [],
  );

  if (!padTex || !trackTex) return null;

  return (
    <group>
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
