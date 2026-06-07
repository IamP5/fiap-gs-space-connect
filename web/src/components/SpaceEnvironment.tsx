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
//      sparse near-shell of foreground stars. As of issue #106 the stars TWINKLE:
//      a per-star `aPhase` attribute + per-star `aFreq` and a `uTime` uniform let
//      the onBeforeCompile patch scale gl_PointSize by 0.7 + 0.3*sin(uTime*freq +
//      aPhase). The animation is driven by SkyAnimator's single useFrame, which
//      also fires occasional meteor streaks. It PAUSES while the tab is hidden so
//      the demand loop only burns frames when the page is actually visible (the
//      Wave-3 motion relaxation of ADR-0004's idle-fps invariant).
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

import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Environment, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { Line2 } from "three-stdlib";
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
// wash — the Moon/Earth stay the focus. Wave 4: nudged 0.8→0.9 so the warm galactic
// dust band reads a touch richer behind the dark-side crescent Moon (SVS #14992).
const STAR_BG_INTENSITY = 0.9;

// The Milky-Way band carries most of the sky detail, so the hand-rolled points
// shell is a sparse near-field of foreground stars layered ON TOP of the band
// for extra crisp, brighter accents (issue #91).
const STAR_COUNT = 1400;
const STAR_SHELL_RADIUS = 4000; // well inside the camera far plane (~8000, issue #49).

// Base screen-pixel size; each star scales this by a power-law factor so a few
// stars read bright/large and many stay faint/small. Kept small so stars read as
// crisp pinpoints (the NASA reference) rather than soft blobs.
const STAR_BASE_SIZE = 1.4;

// Twinkle (issue #106): each star carries a random PHASE and a random angular
// FREQUENCY (rad/s). The vertex shader scales gl_PointSize by
// 0.7 + 0.3*sin(uTime*aFreq + aPhase) — a gentle ±30% size shimmer. The slow,
// varied frequencies keep the field from pulsing in unison.
const TWINKLE_FREQ_MIN = 0.6; // rad/s — slowest twinkle
const TWINKLE_FREQ_MAX = 2.2; // rad/s — fastest twinkle

// Meteor streaks (issue #106): every few seconds a short bright streak shoots
// across the foreground star shell and fades over ~800ms. Reusing ONE <Line>
// (pooled): we reposition/orient it and ramp its opacity rather than mounting a
// new object per streak.
const METEOR_FADE_MS = 800; // a streak is fully faded ~800ms after it fires
const METEOR_MIN_GAP_MS = 3000; // earliest next streak after the previous one
const METEOR_MAX_GAP_MS = 8000; // latest next streak
const METEOR_LENGTH = 520; // streak length in world units (on the star shell)
const METEOR_TRAVEL = 900; // how far the streak slides along its heading
const METEOR_SHELL = STAR_SHELL_RADIUS * 0.92; // just inside the star shell
const METEOR_COLOR = new THREE.Color("#dfe9ff"); // cool white, faint blue tint

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

// scene-graph name for the dim points shell, so the decorative <CameraFeel> layer
// (Scene3D, #109) can find it via scene.getObjectByName and apply a tiny trailing
// parallax yaw to THIS layer only — the bright equirect band stays locked. Nothing
// else sets this object's rotation, so CameraFeel owns its rotation.y outright.
export const STARFIELD_PARALLAX_NAME = "starfield-parallax";

function Starfield({ uTime }: { uTime: { value: number } }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const colors = new Float32Array(STAR_COUNT * 3);
    const phases = new Float32Array(STAR_COUNT);
    const freqs = new Float32Array(STAR_COUNT);
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

      // Twinkle phase/frequency (issue #106): random so stars shimmer out of sync.
      phases[i] = Math.random() * Math.PI * 2;
      freqs[i] = TWINKLE_FREQ_MIN + Math.random() * (TWINKLE_FREQ_MAX - TWINKLE_FREQ_MIN);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    g.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    g.setAttribute("aFreq", new THREE.BufferAttribute(freqs, 1));
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
      // Share the SkyAnimator-driven clock so the twinkle advances in lockstep
      // with the meteor timing (one useFrame for the whole sky).
      shader.uniforms.uTime = uTime;
      shader.vertexShader =
        "attribute float aSize;\n" +
        "attribute float aPhase;\n" +
        "attribute float aFreq;\n" +
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "gl_PointSize = size;",
          // Per-star ±30% size shimmer (issue #106). 0.7 + 0.3*sin keeps the
          // factor in [0.4, 1.0] so stars only ever dim/shrink from their baked
          // size — they never balloon past the crisp pinpoint look.
          "gl_PointSize = aSize * (0.7 + 0.3 * sin(uTime * aFreq + aPhase));",
        );
    };
    return m;
    // uTime is a stable object ref (created once in SpaceEnvironment); the patch
    // reads it by reference, so the material is still built exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispose the geometry AND the hand-rolled material on unmount.
  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <points name={STARFIELD_PARALLAX_NAME} raycast={() => null}>
      <primitive object={geometry} attach="geometry" />
      <primitive object={material} attach="material" />
    </points>
  );
}

// One live meteor streak. State lives in refs (mutated in SkyAnimator's useFrame)
// so a firing streak never triggers a React re-render — the demand loop only
// wakes via invalidate() while the streak is actually visible.
type MeteorState = {
  active: boolean;
  start: number; // performance.now() when this streak fired
  // World-space origin and a unit heading; the streak slides origin → origin +
  // heading*METEOR_TRAVEL over its life and fades out over METEOR_FADE_MS.
  origin: THREE.Vector3;
  heading: THREE.Vector3;
};

// SkyAnimator owns the SINGLE useFrame for the sky (issue #106): it advances the
// shared `uTime` clock (twinkle) and animates one pooled meteor <Line>. Per the
// Wave-3 motion relaxation it PAUSES while the tab is hidden — the rAF/useFrame
// loop only invalidates while the page is visible. The twinkle invalidates every
// visible frame; the meteor adds invalidations only while it is mid-streak.
//
// Snapshot purity (ADR-0004): nothing here reads or writes snapshot state — the
// timing is pure wall-clock + Math.random, so the sky is decorative and stays
// independent of the world snapshot.
function SkyAnimator({ uTime }: { uTime: { value: number } }) {
  const invalidate = useThree((s) => s.invalidate);
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<Line2>(null);

  // Reusable scratch vectors for orienting the streak (built once, no per-frame
  // allocation). X_AXIS is the streak's local heading before we rotate the group.
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const xAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);

  // Meteor scheduling/state in a ref (no re-render on fire). `nextAt` is the next
  // scheduled fire time; it is (re)seeded relative to performance.now() so pauses
  // don't dump a backlog of streaks the moment the tab returns.
  const meteor = useRef<MeteorState>({
    active: false,
    start: 0,
    origin: new THREE.Vector3(),
    heading: new THREE.Vector3(),
  });
  const nextAt = useRef(0);

  // Seed/track tab visibility so the loop pauses while hidden. We re-anchor the
  // meteor schedule on each resume so it doesn't immediately fire a backlog, and
  // wake the loop once on resume so twinkle picks back up.
  const visibleRef = useRef(!document.hidden);
  useEffect(() => {
    const onVisibility = () => {
      const visible = !document.hidden;
      visibleRef.current = visible;
      if (visible) {
        // Re-anchor the next meteor relative to now (drop any while-hidden backlog).
        nextAt.current =
          performance.now() +
          METEOR_MIN_GAP_MS +
          Math.random() * (METEOR_MAX_GAP_MS - METEOR_MIN_GAP_MS);
        invalidate(); // resume the demand loop → twinkle ticks again
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [invalidate]);

  // Fire a fresh streak: a random origin on the upper star shell and a heading
  // that mostly sweeps sideways-and-down (the classic shooting-star look).
  const fireMeteor = (now: number) => {
    const m = meteor.current;
    // Random point on the shell, biased to the upper hemisphere so streaks read.
    const u = Math.random() * 0.9 + 0.05; // cos(theta) ∈ (0.05, 0.95): upper sky
    const phi = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    m.origin.set(r * Math.cos(phi), u, r * Math.sin(phi)).multiplyScalar(METEOR_SHELL);
    // Heading: tangent-ish, pulled downward, then normalised. Avoid the radial
    // direction so the streak slides across the sky rather than toward the camera.
    m.heading
      .set(Math.random() * 2 - 1, -(Math.random() * 0.6 + 0.2), Math.random() * 2 - 1)
      .normalize();
    m.start = now;
    m.active = true;
  };

  useFrame(() => {
    if (!visibleRef.current) return; // paused while the tab is hidden
    const now = performance.now();
    uTime.value = now / 1000;

    // Schedule the first streak lazily (after mount) so it doesn't fire instantly.
    if (nextAt.current === 0) {
      nextAt.current =
        now + METEOR_MIN_GAP_MS + Math.random() * (METEOR_MAX_GAP_MS - METEOR_MIN_GAP_MS);
    }

    const m = meteor.current;
    if (!m.active && now >= nextAt.current) {
      fireMeteor(now);
      nextAt.current =
        now + METEOR_MIN_GAP_MS + Math.random() * (METEOR_MAX_GAP_MS - METEOR_MIN_GAP_MS);
    }

    const group = groupRef.current;
    const line = lineRef.current;
    if (m.active && group && line) {
      const t = (now - m.start) / METEOR_FADE_MS; // 0 → 1 over the streak's life
      if (t >= 1) {
        m.active = false;
        group.visible = false;
      } else {
        group.visible = true;
        // Slide the streak along its heading and orient local +X to that heading.
        tmpDir.copy(m.heading);
        group.position.copy(m.origin).addScaledVector(tmpDir, t * METEOR_TRAVEL);
        // local +X (the line runs along X) → world heading
        group.quaternion.setFromUnitVectors(xAxis, tmpDir);
        // Ease-out fade: bright at birth, gone by ~800ms.
        const mat = line.material as THREE.Material & { opacity: number };
        mat.opacity = (1 - t) * (1 - t);
      }
    }

    // Twinkle repaints every visible frame; an active meteor keeps it alive too.
    invalidate();
  });

  // Two-point segment along local +X; the group positions/orients/fades it.
  const points = useMemo<[number, number, number][]>(
    () => [
      [-METEOR_LENGTH / 2, 0, 0],
      [METEOR_LENGTH / 2, 0, 0],
    ],
    [],
  );

  return (
    <group ref={groupRef} visible={false}>
      <Line
        ref={lineRef}
        points={points}
        color={METEOR_COLOR}
        lineWidth={1.6}
        transparent
        opacity={0}
        depthWrite={false}
        raycast={() => null}
      />
    </group>
  );
}

export function SpaceEnvironment() {
  // Shared twinkle clock: one stable uniform object read by the star shader patch
  // and mutated each frame by SkyAnimator. Created once so the material compiles
  // exactly once (no shader rebuilds).
  const [uTime] = useState(() => ({ value: 0 }));
  return (
    <>
      {/* Milky-Way equirect on scene.background (imperative loader, black
          fallback). Separate from the IBL environment below. */}
      <StarBackground />
      {/* Sparse foreground star points (per-vertex size/brightness/color),
          twinkled by the shared uTime clock (issue #106). */}
      <Starfield uTime={uTime} />
      {/* The single sky useFrame: drives twinkle + meteor streaks, pauses while
          the tab is hidden (issue #106). */}
      <SkyAnimator uTime={uTime} />
      {/* HDR under Suspense (never block paint) + error boundary (never blank). */}
      <EnvErrorBoundary>
        <Suspense fallback={null}>
          <HdrBackdrop />
        </Suspense>
      </EnvErrorBoundary>
    </>
  );
}
