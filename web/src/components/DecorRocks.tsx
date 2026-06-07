// DecorRocks — a STATIC, snapshot-independent scatter of low-poly rocks dressing
// the regolith around the worksite (#58a). Like SpaceEnvironment and
// LaunchScenery, this encodes NO world state: it always renders the same field,
// so the scene stays a pure function of the snapshot (ADR-0004 explicitly allows
// snapshot-independent decorative elements). It is mounted unconditionally.
//
// DRAW-CALL BUDGET (the whole point of #58): every rock is one <Instance> of a
// single shared geometry+material under drei's <Instances frames={1}>, so the
// ENTIRE field renders in ~ONE draw call (an InstancedMesh) instead of N. With
// frames={1}, drei computes the per-instance matrices ONCE on mount and then
// stops its internal useFrame, so the field adds NO per-frame work — demand-loop
// safe (no idle fps burn).
//
// NON-PICKABLE (critical, #48): the instanced mesh sets raycast={() => null}, so
// the ONLY pickable surface in the scene stays each rover's invisible hit-proxy
// sphere. Click-to-kill and the onPointerMissed empty-space deselect stay
// deterministic — rocks can never steal a pick.
//
// GRACEFUL FALLBACK (ADR-0004): the boulder texture is loaded imperatively with a
// SWALLOWED catch (no Suspense-throwing loader). Until/if it resolves the rocks
// render as flat regolith-grey — the field NEVER blanks or throws. invalidate()
// is called ONCE when the texture resolves so the new skin paints, then the
// demand loop returns to 0 idle fps.

import { useEffect, useMemo, useState } from "react";
import { Instance, Instances } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { GROUND_SPAN } from "../lib/scene";
import { applyMaxAnisotropy } from "../lib/textureFidelity";
import { loadTexture, preloadTexture } from "../lib/textureCache";

// Self-hosted CC0 boulder PBR set (Poly Haven "Rock Boulder Dry", 512). The
// diffuse was already vendored (#58a); the normal + roughness maps were added for
// the material tier polish (#111) so the boulders carry real microrelief + varied
// specular instead of reading as flat diffuse spheres. All credited in CREDITS.md.
// Exported so the preload manifest (lib/assets.ts) references the SAME URLs the
// field tiles — the manifest can't drift from the component (Epic 05 P1).
export const ROCK_DIFF = "/assets/textures/rock_boulder_dry_diff_512.jpg";
export const ROCK_NORMAL = "/assets/textures/rock_boulder_dry_nor_gl_512.jpg";
export const ROCK_ROUGH = "/assets/textures/rock_boulder_dry_rough_512.jpg";

// The PBR channels loaded onto the shared boulder material, paired with the
// material slot + correct colourSpace: diffuse is sRGB, normal/roughness linear.
const ROCK_MAPS: {
  url: string;
  key: "map" | "normalMap" | "roughnessMap";
  colorSpace: THREE.ColorSpace;
}[] = [
  { url: ROCK_DIFF, key: "map", colorSpace: THREE.SRGBColorSpace },
  { url: ROCK_NORMAL, key: "normalMap", colorSpace: THREE.NoColorSpace },
  { url: ROCK_ROUGH, key: "roughnessMap", colorSpace: THREE.NoColorSpace },
];

const ROCK_COUNT = 80;

// Exclude the central worksite footprint: rovers/tasks/the dome live near the
// origin, fit inside (GROUND_SPAN - 2*GROUND_MARGIN) ≈ 15 units (half-extent
// ~7.5), and their hit-proxies sit there too. Rejecting samples inside this
// radius keeps rocks off the interactive elements so they never overlap a rover
// or block a pick. Rocks scatter from here out toward the terrain edge.
const WORKSITE_RADIUS = 9;
const FIELD_RADIUS = GROUND_SPAN * 0.95; // stay just inside the ±GROUND_SPAN ground

// Flat regolith-grey for the mandatory primitive fallback (shown until/if the
// boulder texture resolves).
const REGOLITH_GREY = "#8a8076";

type Placement = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

// A tiny deterministic PRNG (mulberry32) so the scatter is STABLE across reloads
// and identical between the two renderers — the field is decoration, but a fixed
// seed keeps it reproducible (and avoids a flicker if React ever remounts).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RockMaps = {
  map?: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
};

export function DecorRocks() {
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const [maps, setMaps] = useState<RockMaps>({});

  // One low-poly rock geometry for the whole field, created ONCE. Icosahedron
  // (detail 0) reads as a faceted boulder; per-instance scale/rotation below add
  // the variety, so a single shared geometry keeps the field to one draw call.
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.5, 0), []);

  // Per-instance transforms, generated ONCE and stable across renders (never
  // regenerated per render). Reject samples inside the worksite radius so rocks
  // never overlap the interactive elements, then jitter scale + rotation for
  // variety. Rocks are seated just below y=0 so they read as half-buried regolith.
  const placements = useMemo<Placement[]>(() => {
    const rand = mulberry32(0x5eed58a); // fixed seed → reproducible scatter
    const out: Placement[] = [];
    let guard = 0;
    while (out.length < ROCK_COUNT && guard < ROCK_COUNT * 50) {
      guard++;
      const x = (rand() * 2 - 1) * FIELD_RADIUS;
      const z = (rand() * 2 - 1) * FIELD_RADIUS;
      if (Math.hypot(x, z) < WORKSITE_RADIUS) continue; // skip the worksite footprint
      const scale = 0.35 + rand() * 0.9; // mix of pebbles and small boulders
      out.push({
        // Seat each rock just below the ground so its base is buried, not floating.
        position: [x, -0.5 * scale * 0.5, z],
        rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
        scale,
      });
    }
    return out;
  }, []);

  // Imperative PBR load with a per-channel SWALLOWED catch — NEVER a
  // Suspense-throwing loader, so a missing/slow map can't block first paint or
  // blank the field. Each channel that resolves is folded into the material; any
  // that fail simply leave that slot unset (#111: the diffuse-only / flat-grey
  // fallback still holds — ADR-0004). invalidate() once per resolved channel so
  // the demand loop paints the new skin, then returns to 0 idle fps.
  useEffect(() => {
    let disposed = false;
    const maxAniso = gl.capabilities.getMaxAnisotropy();
    for (const slot of ROCK_MAPS) {
      // Shared URL-keyed cache (textureCache): one decoded texture per URL, shared
      // with the preload pass so the descent shows no pop-in. The cache OWNS the
      // texture (we never dispose it). colorSpace/anisotropy is per-URL config here.
      const tex = loadTexture(slot.url);
      tex.colorSpace = slot.colorSpace;
      // Max anisotropy (#100): the rock field sprawls to the terrain edge, so far
      // rocks are seen at a grazing angle — sharpen them like the terrain.
      applyMaxAnisotropy(tex, maxAniso);
      void preloadTexture(slot.url).then(() => {
        if (disposed || !tex.image) return; // failed ⇒ leave the slot unset (ADR-0004)
        setMaps((prev) => ({ ...prev, [slot.key]: tex }));
        invalidate(); // wake the demand loop once so the new channel shows
      });
    }
    return () => {
      // The cache owns the textures (shared, session-lived) — do NOT dispose here.
      disposed = true;
    };
  }, [invalidate, gl]);

  // Dispose the geometry we own on unmount (the material is disposed by r3f).
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    // ONE InstancedMesh for the whole field. frames={1}: compute the instance
    // matrices once, then stop the internal useFrame (demand-loop safe).
    // raycast={() => null}: the field is decoration and must never be pickable.
    <Instances geometry={geometry} frames={1} raycast={() => null}>
      <meshStandardMaterial
        map={maps.map ?? undefined}
        normalMap={maps.normalMap ?? undefined}
        roughnessMap={maps.roughnessMap ?? undefined}
        color={maps.map ? "#ffffff" : REGOLITH_GREY}
        // The roughnessMap modulates this base when present; without it the field
        // keeps the flat matte regolith look.
        roughness={maps.roughnessMap ? 1 : 0.95}
        metalness={0}
      />
      {placements.map((p, i) => (
        <Instance
          key={i}
          position={p.position}
          rotation={p.rotation}
          scale={p.scale}
        />
      ))}
    </Instances>
  );
}
