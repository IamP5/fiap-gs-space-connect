// SpaceEnvironment — a STATIC, snapshot-independent backdrop for the lunar
// diorama (issue #50). It encodes NO world state — same category as LunarTerrain
// and the fixed light rig — so it respects ADR-0004's "scene is a pure function
// of the snapshot" invariant (decorative, snapshot-independent elements are
// allowed). It is mounted unconditionally, even when the snapshot is null.
//
// Two layers:
//   1. A hand-rolled THREE.Points starfield — positions generated ONCE in a
//      useMemo (random points on a large sphere shell). NO useFrame: twinkling
//      would pin the demand loop at 60fps. (drei's <Stars> animates per-frame,
//      so it is intentionally NOT used here.)
//   2. A SELF-HOSTED HDR via drei's <Environment files=...> used for PBR
//      image-based lighting ONLY (no `background`), so metallic glTFs (the
//      Kenney hangar dome) show real reflections. The visible sky stays the
//      starfield over the Canvas's black background — this is the MOON, so the
//      skybox must read as space, NOT the terrestrial horizon baked into the
//      HDRI. We use files= (a vendored CC0 .hdr in /public), NEVER preset=
//      (which fetches a CDN). The cubemap renders once on load → demand-safe.
//
// GRACEFUL FALLBACK: drei's <Environment files> uses useLoader, which SUSPENDS
// while loading and THROWS if the file is missing/corrupt. We wrap it in a
// Suspense (so it never blocks first paint) AND an error boundary (so a failed
// HDR is swallowed) — the starfield + the black <color attach="background"> in
// the Canvas then remain as the backdrop and the scene never goes blank. (The
// mandatory "primitive fallback for every asset" rule from ADR-0004.)
//
// invalidate() is called ONCE when the HDR finishes loading so the demand loop
// paints the new skybox + IBL; after that the loop returns to 0 idle fps.

import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { Environment } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// Self-hosted CC0 HDRI (Poly Haven "Moonless Golf", 2k). See public/assets/CREDITS.md.
const HDR_FILE = "/assets/hdr/moonless_golf_2k.hdr";

const STAR_COUNT = 1500;
const STAR_SHELL_RADIUS = 4000; // well inside the camera far plane (~8000, issue #49).

// A tiny error boundary so a missing/failed HDR can never blank the scene: if
// the <Environment> loader throws, we render nothing and the Canvas's black
// background stays as the graceful fallback (ADR-0004 mandatory fallback).
class EnvErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The self-hosted HDR as the IBL source (no `background` — the starfield/black
// is the visible space sky). Kept in its own component so it sits under the
// Suspense boundary; it wakes the demand loop once on (re)load.
function HdrBackdrop() {
  const invalidate = useThree((s) => s.invalidate);
  // <Environment files> suspends until the .hdr is decoded; this effect runs on
  // the FIRST committed render after it resolves — i.e. once, on load — so we
  // paint the new reflections without any per-frame work.
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  // IBL only: no `background`, so the HDRI lights metals but is never shown as
  // the sky (it's a terrestrial HDRI — its horizon/trees must not appear in space).
  return <Environment files={HDR_FILE} />;
}

// A static starfield: points on a sphere shell, generated once. No useFrame.
function Starfield() {
  const geometry = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Uniform-ish direction on the unit sphere, then push out to the shell.
      const u = Math.random() * 2 - 1; // cos(theta) in [-1, 1]
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const x = r * Math.cos(phi);
      const y = u;
      const z = r * Math.sin(phi);
      positions[i * 3] = x * STAR_SHELL_RADIUS;
      positions[i * 3 + 1] = y * STAR_SHELL_RADIUS;
      positions[i * 3 + 2] = z * STAR_SHELL_RADIUS;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, []);

  // Dispose the geometry on unmount (the material is disposed by r3f).
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <points raycast={() => null}>
      <primitive object={geometry} attach="geometry" />
      <pointsMaterial
        color="#ffffff"
        // sizeAttenuation={false}: stars are points of light at "infinity", so
        // `size` is a CONSTANT screen-pixel size regardless of the 4000-unit
        // shell distance. With sizeAttenuation ON, gl_PointSize = size *
        // (canvasHeight*0.5)/distance collapses to sub-pixel at this range and
        // the starfield is invisible. A constant ~1.8px reads as a crisp star.
        size={1.8}
        sizeAttenuation={false}
        transparent
        opacity={0.9}
        depthWrite={false}
      />
    </points>
  );
}

export function SpaceEnvironment() {
  return (
    <>
      <Starfield />
      {/* HDR under Suspense (never block paint) + error boundary (never blank). */}
      <EnvErrorBoundary>
        <Suspense fallback={null}>
          <HdrBackdrop />
        </Suspense>
      </EnvErrorBoundary>
    </>
  );
}
