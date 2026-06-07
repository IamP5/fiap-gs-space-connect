// SpaceEnvironment — a STATIC, snapshot-independent backdrop for the lunar
// diorama (issue #50). It encodes NO world state — same category as LunarTerrain
// and the fixed light rig — so it respects ADR-0004's "scene is a pure function
// of the snapshot" invariant (decorative, snapshot-independent elements are
// allowed). It is mounted unconditionally, even when the snapshot is null.
//
// Three layers:
//   1. A Milky-Way EQUIRECTANGULAR background (issue #83) — a self-hosted Deep
//      Star Maps 2020 (SVS 4851, Gaia DR2) JPG assigned IMPERATIVELY to
//      scene.background (EquirectangularReflectionMapping, SRGBColorSpace,
//      max anisotropy). This is the WebGLBackground pass (not geometry), so it
//      ignores the camera far-plane and always fills behind everything. Kept
//      SEPARATE from the IBL `environment` (two independent slots). Loaded
//      imperatively (mirroring HdrBackdrop): on success it invalidate()s ONCE;
//      on failure it leaves the Canvas's black <color attach="background">
//      fallback untouched (ADR-0004). It captures/restores the previous
//      scene.background and disposes its texture on unmount. NO useFrame.
//   2. A hand-rolled THREE.Points starfield — positions, per-vertex SIZE and
//      COLOR generated ONCE in a useMemo (issue #91). Power-law size/brightness
//      (a few bright, many faint) + slight color variance (mostly white, a few
//      warm/cool) baked into static attributes. The Milky-Way band now carries
//      most of the sky detail, so the point count is REDUCED — this field is a
//      sparse near-shell of foreground stars. NO useFrame: twinkling would pin
//      the demand loop at 60fps. (drei's <Stars> animates per-frame, so it is
//      intentionally NOT used here.)
//   3. A SELF-HOSTED HDR via drei's <Environment files=...> used for PBR
//      image-based lighting ONLY (no `background`), so metallic glTFs (the
//      Kenney hangar dome) show real reflections. We use files= (a vendored CC0
//      .hdr in /public), NEVER preset= (which fetches a CDN). The cubemap
//      renders once on load → demand-safe.
//
// GRACEFUL FALLBACK: drei's <Environment files> uses useLoader, which SUSPENDS
// while loading and THROWS if the file is missing/corrupt. We wrap it in a
// Suspense (so it never blocks first paint) AND an error boundary (so a failed
// HDR is swallowed) — the starfield + the Milky-Way background (or the black
// <color attach="background"> in the Canvas if THAT also fails) then remain as
// the backdrop and the scene never goes blank. (The mandatory "primitive
// fallback for every asset" rule from ADR-0004.)
//
// invalidate() is called ONCE when each texture finishes loading so the demand
// loop paints the new skybox/IBL; after that the loop returns to 0 idle fps.

import { Component, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { Environment } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

// Self-hosted CC0 HDRI (Poly Haven "Moonless Golf", 2k). See public/assets/CREDITS.md.
const HDR_FILE = "/assets/hdr/moonless_golf_2k.hdr";

// Self-hosted Deep Star Maps 2020 (NASA/Goddard SVS 4851, Gaia DR2) equirect,
// galactic coords (the warm dust band sits along the equator). Converted offline
// from the 8k EXR → 8192×4096 sRGB JPG (4× the linear resolution of the prior 4k
// → crisp pinpoint stars + smooth dust, matching the NASA SVS look). The galactic
// projection lays the band horizontally; backgroundRotation (below) rolls/yaws it
// so the bright galactic-centre dust runs DIAGONALLY through the orbit frame,
// behind the Moon+Earth, as in the reference render (SVS #14992). See CREDITS.md.
const STAR_BG_FILE = "/assets/starmap_2020_8k_gal.jpg";

// scene.backgroundRotation (three r0.169): roll tilts the horizontal galactic band
// to a diagonal; yaw swings the bright galactic-centre bulge toward the orbit
// camera's look direction so the warm dust reads in-frame (not behind us). The
// orbit camera looks mostly toward -X, which samples the equirect's galactic
// ANTI-centre (the dimmest edge of the _gal map) by default — a 180° yaw brings
// the bright central dust/bulge into the frame.
const STAR_BG_YAW_DEG = 180; // swing galactic centre into the orbit view
const STAR_BG_ROLL_DEG = 28; // diagonal tilt of the band
// scene.backgroundIntensity (three r0.169): scales the band/star map brightness.
// Kept below 1 so the galaxy reads as a faint deep-space backdrop, not a bright
// wash — the Moon/Earth stay the focus.
const STAR_BG_INTENSITY = 0.8;

// The Milky-Way band carries most of the sky detail, so the hand-rolled points
// shell is a sparse near-field of foreground stars layered ON TOP of the band
// for extra crisp, brighter accents (issue #91).
const STAR_COUNT = 1400;
const STAR_SHELL_RADIUS = 4000; // well inside the camera far plane (~8000, issue #49).

// Base screen-pixel size; each star scales this by a power-law factor so a few
// stars read bright/large and many stay faint/small. Kept small so stars read as
// crisp pinpoints (the NASA reference) rather than soft blobs.
const STAR_BASE_SIZE = 1.4;

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

// Milky-Way equirectangular background (issue #83). Loaded IMPERATIVELY and
// assigned to scene.background — SEPARATE from the IBL `environment` (drei's
// <Environment> above owns that slot). This is the WebGLBackground pass, not
// geometry, so it ignores the camera far-plane and always fills behind the
// scene. NO useFrame: it wakes the demand loop exactly once on load.
//
// FALLBACK (ADR-0004): we capture the previous scene.background (the black
// <color attach="background"> set in Scene3D) before loading; on load FAILURE we
// leave it untouched so the void stays black; on unmount we restore it and
// dispose the texture we created.
function StarBackground() {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let cancelled = false;
    const prev = scene.background; // the black <color> fallback from Scene3D
    new THREE.TextureLoader().load(
      STAR_BG_FILE,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = gl.capabilities.getMaxAnisotropy();
        // Keep trilinear mipmapping (three defaults) — sharpness comes from the 8k
        // source, NOT from disabling mips (which would shimmer the minified stars).
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        scene.background = tex;
        // Orient + brighten the galactic band (three r0.169) so the warm dust runs
        // diagonally through the orbit frame behind the bodies.
        scene.backgroundRotation = new THREE.Euler(
          0,
          THREE.MathUtils.degToRad(STAR_BG_YAW_DEG),
          THREE.MathUtils.degToRad(STAR_BG_ROLL_DEG),
        );
        scene.backgroundIntensity = STAR_BG_INTENSITY;
        invalidate(); // wake the demand loop ONCE
      },
      undefined,
      () => {
        /* load failed → leave the black background (ADR-0004 fallback) */
      },
    );
    return () => {
      cancelled = true;
      const cur = scene.background;
      // Only restore/dispose if WE installed a texture; if the load failed or is
      // still pending, `cur` is still `prev` and we must not dispose it.
      if (cur instanceof THREE.Texture && cur !== prev) {
        scene.background = prev;
        scene.backgroundIntensity = 1;
        scene.backgroundRotation = new THREE.Euler();
        cur.dispose();
      }
    };
  }, [scene, gl, invalidate]);
  return null;
}

// The self-hosted HDR as the IBL source (no `background` — the Milky-Way
// equirect / starfield / black is the visible space sky). Kept in its own
// component so it sits under the Suspense boundary; it wakes the demand loop
// once on (re)load.
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
// Per-vertex SIZE and COLOR are baked into static attributes (issue #91):
//   - Power-law size/brightness: most stars are small/faint, a few are large/
//     bright. We draw u∈[0,1] and raise it to a high power so the distribution
//     is heavily skewed toward the faint end (a realistic magnitude spread).
//   - Color variance: mostly white, a minority warm (#ffd8b0) or cool (#cfe0ff).
// Both feed a `pointsMaterial` patched via onBeforeCompile to read a custom
// `aSize` attribute for gl_PointSize (vanilla pointsMaterial has only a single
// uniform `size`). `vertexColors` is supported natively. Everything is computed
// ONCE in useMemo and never animated.
const WARM_STAR = new THREE.Color("#ffd8b0");
const COOL_STAR = new THREE.Color("#cfe0ff");
const WHITE_STAR = new THREE.Color("#ffffff");

function Starfield() {
  const geometry = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const colors = new Float32Array(STAR_COUNT * 3);
    const tmp = new THREE.Color();
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

      // Power-law magnitude: t∈[0,1] skewed toward 0 (faint) via ^3. A handful
      // land near 1 → the bright/large stars. Map to pixel size and brightness.
      const t = Math.pow(Math.random(), 3);
      sizes[i] = STAR_BASE_SIZE * (0.45 + t * 1.3); // ~0.6px faint … ~2.4px bright (small/crisp)
      const brightness = 0.4 + t * 0.4; // faint stars are dimmer; lower overall

      // Color variance: ~90% white, ~6% warm, ~4% cool — mostly neutral pinpoints
      // (the NASA reference is a predominantly white field, not a colourful one).
      const c = Math.random();
      const base = c < 0.06 ? WARM_STAR : c < 0.1 ? COOL_STAR : WHITE_STAR;
      tmp.copy(base).multiplyScalar(brightness);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, []);

  // Patch pointsMaterial to honour the per-vertex `aSize` attribute. We keep
  // sizeAttenuation OFF (stars are at "infinity" — constant screen-pixel size;
  // attenuation collapses them to sub-pixel at the 4000-unit shell), so the
  // injected gl_PointSize is simply the attribute value in device pixels.
  const material = useMemo(() => {
    const m = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    m.onBeforeCompile = (shader) => {
      shader.vertexShader =
        "attribute float aSize;\n" +
        shader.vertexShader.replace(
          "gl_PointSize = size;",
          "gl_PointSize = aSize;",
        );
    };
    return m;
  }, []);

  // Dispose the geometry AND the hand-rolled material on unmount.
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <points raycast={() => null}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </points>
  );
}

export function SpaceEnvironment() {
  return (
    <>
      {/* Milky-Way equirect on scene.background (imperative loader, black
          fallback). Separate from the IBL environment below. */}
      <StarBackground />
      {/* Sparse foreground star points (per-vertex size/brightness/color). */}
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
