// SpaceEnvironment — a STATIC, snapshot-independent backdrop for the lunar
// diorama (issue #50). It encodes NO world state — same category as LunarTerrain
// and the fixed light rig — so it respects ADR-0004's "scene is a pure function
// of the snapshot" invariant (decorative, snapshot-independent elements are
// allowed). It is mounted unconditionally, even when the snapshot is null.
//
// Three layers:
//   1. A Milky-Way SKY SPHERE (issue #83, reworked) — a self-hosted Deep Star
//      Maps 2020 (SVS 4851, Gaia DR2) equirect on a camera-following inward
//      sphere (<SkySphere>), NOT on scene.background. Why not the background
//      slot (load-bearing — this was the black-sky bug): three r169's
//      WebGLBackground converts ANY equirect background to a cubemap via
//      WebGLCubeMaps → `new WebGLCubeRenderTarget(image.height)` — for the 16k
//      KTX2 that is an 8192³×6 RGBA8 render target (~1.6 GB VRAM), AND
//      fromEquirectangularTexture copies generateMipmaps:false +
//      minFilter:LinearMipmapLinear from the CompressedTexture onto the RT —
//      a mipmap filter with no mipmaps = incomplete texture = the GPU samples
//      BLACK. The sphere samples the BC7 texture DIRECTLY (file mips + max
//      anisotropy, no conversion, no hidden RT — even the old 8k JPG path was
//      silently paying a ~536 MB cubemap). The sphere follows the camera
//      position (zero parallax, like a true background), never writes/tests
//      depth, draws first (renderOrder), ignores fog and tone mapping (the
//      background pass never tone-mapped sRGB textures either). On load failure
//      the mesh never mounts and the Canvas's black <color attach="background">
//      remains (ADR-0004).
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
import { Environment } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { loadTexture, preloadTexture } from "../lib/textureCache";
import { reportAssetWarning } from "../lib/assetLog";

// Self-hosted CC0 HDRI (Poly Haven "Moonless Golf", 2k). See public/assets/CREDITS.md.
// Exported so the preload manifest (lib/assets.ts) references the SAME URL (Epic 05 P1).
export const HDR_FILE = "/assets/hdr/moonless_golf_2k.hdr";

// Self-hosted Deep Star Maps 2020 (NASA/Goddard SVS 4851, Gaia DR2) equirect,
// galactic coords (the warm dust band sits along the equator). Converted offline
// from the 8k EXR → 8192×4096 sRGB JPG (4× the linear resolution of the prior 4k
// → crisp pinpoint stars + smooth dust, matching the NASA SVS look). The galactic
// projection lays the band horizontally; the sky sphere's rotation (below) rolls/
// yaws it so the bright galactic-centre dust runs DIAGONALLY through the orbit
// frame, behind the Moon+Earth, as in the reference render (SVS #14992). See
// CREDITS.md. Exported so the preload manifest (lib/assets.ts) references the
// SAME URL (Epic 05 P1).
export const STAR_BG_FILE = "/assets/starmap_2020_8k_gal.jpg";

// PRIMARY backdrop: the SAME Deep Star Maps 2020 source at 16k, GPU-compressed
// to Basis-LZ/ETC1S in a .ktx2 (converted offline: 16k EXR → sRGB PNG, tone-
// matched to the 8k JPG above → ETC1S q255 + mipmaps, see public/assets/
// CREDITS.md). It transcodes to BC7 (~1 byte/texel) on desktop: 16384×8192 with
// mips is ~179 MB on the GPU — same as the 8k RGBA8 it replaces, with 4× the
// linear resolution (crisp pinpoint stars + finer dust), and the <SkySphere>
// path drops the hidden ~536 MB background cubemap on top. The 8k JPG remains
// the ADR-0004 fallback (used if the GPU can't transcode KTX2 or the file fails).
export const STAR_BG_KTX2 = "/assets/starmap_2020_16k_gal.ktx2";

// Lazily-built, session-shared KTX2 loader. detectSupport(gl) inspects the LIVE
// renderer to pick the transcode target (ASTC / BC7 / ETC / S3TC), so this MUST run
// with a renderer in hand — which is precisely why the starmap is the one texture
// NOT routed through the no-GL preload cache (lib/textureCache). Instead lib/assets
// warms its BYTES with a plain fetch behind the splash, and the GPU transcode
// happens here at scene mount (off the warm HTTP cache, so no network wait). The
// transcoder JS+wasm are vendored to /public/assets/basis (three's copy).
let ktx2Loader: KTX2Loader | null = null;
function getKTX2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader().setTranscoderPath("/assets/basis/").detectSupport(gl);
  }
  return ktx2Loader;
}

// Sky-sphere orientation, applied DIRECTLY as the sphere mesh rotation (the
// sphere owns its orientation outright — the old drei-vs-imperative
// backgroundRotation ownership dance is gone with the scene.background slot).
// The angles were tuned ON SCREEN against the live orbit/surface cameras (raw
// renders, composer frozen) — they are NOT the old backgroundRotation values:
// the mirrored-sphere mapping has a different phase than the background
// shader's sample-direction rotation, so the old 180°/106° yaws don't transfer.
//
// With the mesh at identity the bright galactic-centre bulge already faces the
// orbit camera (≈ −X); pitch (X) + roll (Z) then swing the band into the Wave-4
// diagonal that runs BEHIND the Moon+Earth (SVS #14992).
const SKY_PITCH_DEG = 25; // shared: tips the band into the diagonal arc
const SKY_ROLL_DEG = 18; // shared: rolls the dust lane across the frame
// PER-VIEW YAW (the "dust band swings to the opposite side on descent" fix): the
// sky is sampled purely by camera ORIENTATION, and the two views look very
// different ways — orbit looks toward the Moon (≈ −X), the surface camera looks
// toward ≈ −Z, ~74° further around the world up-axis. A single fixed yaw (tuned
// for orbit) would swing the bright bulge ~74° out of the surface frame. Each
// view gets its OWN yaw; the re-orient applies when the rendered view flips,
// which on a descent happens at the t=0.5 glare peak — so the band never flips
// on-screen; it's already framed when the flash clears. On the surface the same
// pitch/roll lift the galactic centre into a dramatic ARC above the lunar
// horizon (the airless-Moon "the whole galaxy hangs overhead" look).
const SKY_YAW_ORBIT_DEG = 0;
const SKY_YAW_SURFACE_DEG = -74; // the orbit→surface heading delta

// The sky quaternion for a given view (THREE.Euler default 'XYZ' order).
function skyQuaternionFor(onSurface: boolean): THREE.Quaternion {
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(SKY_PITCH_DEG),
    THREE.MathUtils.degToRad(onSurface ? SKY_YAW_SURFACE_DEG : SKY_YAW_ORBIT_DEG),
    THREE.MathUtils.degToRad(SKY_ROLL_DEG),
  );
  return new THREE.Quaternion().setFromEuler(e);
}
// Band/star map brightness (multiplies the sphere material color — same linear
// scale the old scene.backgroundIntensity applied). Kept below 1 in orbit so the
// galaxy reads as a faint deep-space backdrop, not a bright wash — the Moon/Earth
// stay the focus. Per-view: the surface sky is pure black void (no Moon globe
// filling the frame), so the band carries a touch more brightness there to read
// as the hero backdrop; orbit stays lower so the galaxy never out-shines the
// crescent Moon.
const STAR_BG_INTENSITY_ORBIT = 0.9;
const STAR_BG_INTENSITY_SURFACE = 1.08;

// Sky-sphere shell: outside every scene object that should occlude it (star
// points 4000, meteors ~3680, Moon globe, terrain) and inside the camera far
// plane (8000, issue #49). The sphere FOLLOWS the camera position each frame, so
// like the old background pass it has zero parallax and can never be exited.
const SKY_SPHERE_RADIUS = 7000;
// Drawn before everything else in the opaque pass; with depthWrite/depthTest off
// it can neither occlude nor be occluded incorrectly — it is pure backdrop.
const SKY_SPHERE_RENDER_ORDER = -100;

// scene.environmentIntensity scales the IBL (scene.environment = the HDR set by
// drei's <Environment> below) contribution to PBR materials — and that diffuse
// irradiance, not the named lights, sets the Moon's overall brightness. The
// surface keeps full IBL for the metallic rover/glTF reflections; orbit dims it
// HARD so the Moon's far side reads as a dramatic dark crescent (the sun's
// back-light + a faint earthshine do the rest). drei is the SINGLE owner — these
// are passed as the <Environment environmentIntensity> prop so its every-render
// re-apply asserts the per-view value instead of drei's default (1). An imperative
// scene-side setter would be clobbered on the next interaction (same bug class as
// the background band).
const ENV_INTENSITY_SURFACE = 1.0;
const ENV_INTENSITY_ORBIT = 0.05;

// The Milky-Way band carries most of the sky detail, so the hand-rolled points
// shell is a sparse near-field of foreground stars layered ON TOP of the band
// for extra crisp, brighter accents (issue #91).
// Doubled (1400→2800) for a denser, more immersive surface sky. These are static
// points generated once with no per-star CPU cost after build — 2.8k draws as a
// single Points call, so the field reads richer at effectively zero frame cost.
const STAR_COUNT = 2800;
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

// Meteor streaks (issue #106, upgraded for milestone 08): every few seconds a
// bright tapered streak shoots across the foreground star shell and fades over
// ~900ms. A POOL of two textured quads (additive, a procedural hot-head →
// fading-tail gradient) is reused — repositioned/oriented/faded in refs, never
// remounted — so a firing streak costs two transparent draws at most and zero
// React re-renders. Each streak randomises its length/width/tint so no two
// meteors read identical.
const METEOR_POOL = 2; // concurrent streaks (independent schedules)
const METEOR_FADE_MS = 900; // a streak is fully faded ~900ms after it fires
const METEOR_MIN_GAP_MS = 2800; // earliest next streak (per pool slot)
const METEOR_MAX_GAP_MS = 7500; // latest next streak (per pool slot)
const METEOR_LENGTH_MIN = 380; // world units on the shell — randomised per streak
const METEOR_LENGTH_MAX = 680;
const METEOR_WIDTH_MIN = 9; // streak thickness (world units at the shell)
const METEOR_WIDTH_MAX = 16;
const METEOR_TRAVEL = 900; // how far the streak slides along its heading
const METEOR_SHELL = STAR_SHELL_RADIUS * 0.92; // just inside the star shell
const METEOR_OPACITY = 0.85; // peak head opacity at birth (eases out as t²)
const METEOR_COOL = new THREE.Color("#dfe9ff"); // most streaks: icy blue-white
const METEOR_WARM = new THREE.Color("#ffdfb8"); // ~15%: a warm fireball
const METEOR_WARM_CHANCE = 0.15;

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

// Milky-Way sky sphere (issue #83, reworked off scene.background — see the
// header comment for WHY the background slot renders compressed equirects
// black). An inward-facing sphere, mirrored via geometry.scale(-1,1,1) (three's
// panorama pattern: the inside view reads un-mirrored, so the sky matches the
// NASA map instead of its mirror image), following the camera position each
// frame for zero parallax. The texture is sampled DIRECTLY — BC7 stays
// compressed in VRAM with its file mipmaps + max anisotropy.
//
// FALLBACK (ADR-0004): the mesh only mounts once a texture has loaded — until
// then (or on total failure) the Canvas's black <color attach="background">
// shows through. KTX2 failure falls back to the warm 8k JPG from the shared
// textureCache (the cache OWNS that texture — never disposed here; the KTX2
// CompressedTexture is OURS and is disposed on unmount).
function SkySphere({ onSurface }: { onSurface: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);

  // The loaded starmap + whether we own it (KTX2 = owned, cached JPG = not).
  // Held in state so the mesh mounts when it arrives; mirrored in a ref so the
  // unmount cleanup sees the latest value without re-running the load effect.
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  const ownedRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;

    const install = (t: THREE.Texture, owned: boolean) => {
      if (cancelled) {
        if (owned) t.dispose();
        return;
      }
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = gl.capabilities.getMaxAnisotropy();
      t.needsUpdate = true;
      ownedRef.current = owned ? t : null;
      setTex(t);
      invalidate(); // wake the demand loop ONCE
    };

    // ADR-0004 fallback: the warm 8k JPG via the shared cache. Used when the GPU
    // can't transcode KTX2 or the .ktx2 fails to load — the void stays black until
    // it arrives, never blanks. The cache OWNS this texture.
    const installJpgFallback = () => {
      const jpg = loadTexture(STAR_BG_FILE);
      void preloadTexture(STAR_BG_FILE).then(() => {
        if (cancelled || !jpg.image) return; // failed load ⇒ keep black
        // Trilinear mips (three defaults) so the minified 8k stars don't shimmer.
        jpg.generateMipmaps = true;
        jpg.minFilter = THREE.LinearMipmapLinearFilter;
        jpg.magFilter = THREE.LinearFilter;
        install(jpg, false);
      });
    };

    // PRIMARY: the 16k Basis/ETC1S KTX2. Its bytes are warmed behind the splash
    // (lib/assets preloadBinary), so this transcode reads the local HTTP cache —
    // no network wait at mount. On ANY failure (unsupported GPU, decode error) we
    // fall back to the 8k JPG. NOTE the KTX2 ships y-flipped (baked at encode,
    // CREDITS.md) because compressed uploads can't flipY — on the mirrored sphere
    // it lands identical to the flipY'd JPG.
    getKTX2Loader(gl).load(
      STAR_BG_KTX2,
      (t) => install(t, true),
      undefined,
      (err) => {
        reportAssetWarning("texture", STAR_BG_KTX2, err);
        installJpgFallback();
      },
    );

    return () => {
      cancelled = true;
      // Free the KTX2 texture we created; never touch the cache-owned JPG.
      ownedRef.current?.dispose();
      ownedRef.current = null;
    };
  }, [gl, invalidate]);

  // Inward-facing shell: the X mirror flips the winding so the default
  // FrontSide material renders the INSIDE faces (three's 360-panorama pattern),
  // and the equirect reads un-mirrored from within.
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(SKY_SPHERE_RADIUS, 96, 48);
    g.scale(-1, 1, 1);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // Per-view orientation + brightness (see skyQuaternionFor / STAR_BG_INTENSITY_*).
  const quaternion = useMemo(() => skyQuaternionFor(onSurface), [onSurface]);
  const tint = useMemo(
    () =>
      new THREE.Color().setScalar(
        onSurface ? STAR_BG_INTENSITY_SURFACE : STAR_BG_INTENSITY_ORBIT,
      ),
    [onSurface],
  );
  // Re-paint once whenever the view (rotation/intensity) flips.
  useEffect(() => {
    invalidate();
  }, [onSurface, invalidate]);

  // Zero-parallax: ride the camera's position (orientation stays world-fixed),
  // exactly like the background pass the sphere replaces. One Vector3 copy per
  // frame — no allocation, no invalidate (only visible when something else moves).
  useFrame(({ camera }) => {
    meshRef.current?.position.copy(camera.position);
  });

  if (!tex) return null; // black <color> fallback until the starmap arrives

  return (
    <mesh
      ref={meshRef}
      name="sky-sphere"
      quaternion={quaternion}
      renderOrder={SKY_SPHERE_RENDER_ORDER}
      frustumCulled={false}
      raycast={() => null}
    >
      <primitive object={geometry} attach="geometry" />
      {/* toneMapped:false matches the old background pass (it never tone-mapped
          sRGB textures); fog:false or the surface fog would grey the whole sky;
          depthWrite/depthTest:false = pure backdrop. */}
      <meshBasicMaterial
        map={tex}
        color={tint}
        toneMapped={false}
        fog={false}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

// The self-hosted HDR as the IBL source (no `background` — the Milky-Way
// equirect / starfield / black is the visible space sky). Kept in its own
// component so it sits under the Suspense boundary; it wakes the demand loop
// once on (re)load.
function HdrBackdrop({ onSurface }: { onSurface: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  // <Environment files> suspends until the .hdr is decoded; this effect runs on
  // the FIRST committed render after it resolves — i.e. once, on load — so we
  // paint the new reflections without any per-frame work.
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  // IBL only (`background` omitted ⇒ false): the HDRI lights metals via
  // scene.environment but is never shown as the sky — the visible backdrop is the
  // <SkySphere> mesh. drei IS, however, the single owner of environmentIntensity
  // (the per-view IBL grade): it re-applies all scene env props on every render
  // (its layout effect has no dep array), so we MUST pass our value here or it
  // resets to drei's default (1) on every interaction — the IBL-grade bug. (Its
  // backgroundIntensity/backgroundRotation re-applies are harmless now: with the
  // sky on a mesh, scene.background stays the static black <color> fallback,
  // which those props don't affect.)
  return (
    <Environment
      files={HDR_FILE}
      environmentIntensity={onSurface ? ENV_INTENSITY_SURFACE : ENV_INTENSITY_ORBIT}
    />
  );
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
  // World-space origin and a unit heading (tangent to the shell); the streak
  // slides origin → origin + heading*METEOR_TRAVEL over its life and fades out
  // over METEOR_FADE_MS.
  origin: THREE.Vector3;
  heading: THREE.Vector3;
  length: number; // randomised per fire (METEOR_LENGTH_MIN..MAX)
  width: number; // randomised per fire (METEOR_WIDTH_MIN..MAX)
};

// Procedural streak texture: a hot white head near the right end tapering into
// a long soft tail, with a gaussian falloff across the width — drawn once on a
// small canvas (256×64). Additive-blended this reads as a glowing shooting star
// with a real trail instead of a hairline. Per-pixel: tail ramp (x^2.6, so most
// of the length stays faint) × vertical gaussian, plus a tight radial hot-core
// blob at the head that saturates to white.
function makeMeteorTexture(): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  const w = 256;
  const h = 64;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const HEAD_X = 0.86; // head position along the quad (tail ramps toward it)
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5) / h - 0.5; // -0.5..0.5 across the width
    const vert = Math.exp(-(dy * dy) / (2 * 0.16 * 0.16)); // σ≈0.16 → soft edge
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      // Tail: 0 at the far left rising to 1 at the head, then a sharp drop to
      // the leading tip so the streak reads as travelling head-first (+X).
      const tail =
        u <= HEAD_X
          ? Math.pow(u / HEAD_X, 2.6)
          : Math.max(0, 1 - (u - HEAD_X) / (1 - HEAD_X));
      // Hot core: a tight gaussian blob centred on the head.
      const dxh = (u - HEAD_X) / 0.05;
      const core = 1.6 * Math.exp(-(dxh * dxh + (dy / 0.1) * (dy / 0.1)));
      const v = Math.min(1, tail * vert + core);
      const i = (y * w + x) * 4;
      const c = Math.round(v * 255);
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = c; // premultiplied-looking alpha; additive ignores it
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// SkyAnimator owns the SINGLE useFrame for the sky (issue #106): it advances the
// shared `uTime` clock (twinkle) and animates the pooled meteor quads. Per the
// Wave-3 motion relaxation it PAUSES while the tab is hidden — the rAF/useFrame
// loop only invalidates while the page is visible. The twinkle invalidates every
// visible frame; the meteors add invalidations only while one is mid-streak.
//
// Snapshot purity (ADR-0004): nothing here reads or writes snapshot state — the
// timing is pure wall-clock + Math.random, so the sky is decorative and stays
// independent of the world snapshot.
function SkyAnimator({ uTime }: { uTime: { value: number } }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRefs = useRef<(THREE.Mesh | null)[]>(Array(METEOR_POOL).fill(null));

  // Reusable scratch vectors/matrix for orienting streaks (no per-frame alloc).
  const tmpN = useMemo(() => new THREE.Vector3(), []);
  const tmpY = useMemo(() => new THREE.Vector3(), []);
  const tmpZ = useMemo(() => new THREE.Vector3(), []);
  const tmpCam = useMemo(() => new THREE.Vector3(), []);
  const tmpM = useMemo(() => new THREE.Matrix4(), []);

  // Per-slot scheduling/state in refs (no re-render on fire). `nextAts` are the
  // next scheduled fire times; (re)seeded relative to performance.now() so pauses
  // don't dump a backlog of streaks the moment the tab returns.
  const meteors = useRef<MeteorState[]>(
    Array.from({ length: METEOR_POOL }, () => ({
      active: false,
      start: 0,
      origin: new THREE.Vector3(),
      heading: new THREE.Vector3(),
      length: METEOR_LENGTH_MIN,
      width: METEOR_WIDTH_MIN,
    })),
  );
  const nextAts = useRef<number[]>(Array(METEOR_POOL).fill(0));
  const gap = () =>
    METEOR_MIN_GAP_MS + Math.random() * (METEOR_MAX_GAP_MS - METEOR_MIN_GAP_MS);

  // The shared streak texture + one material per pool slot (each slot fades and
  // tints independently). Additive blending: black adds nothing, so the quad
  // edges can never read as a rectangle against the sky.
  const streakTex = useMemo(() => makeMeteorTexture(), []);
  const materials = useMemo(
    () =>
      Array.from(
        { length: METEOR_POOL },
        () =>
          new THREE.MeshBasicMaterial({
            map: streakTex,
            color: METEOR_COOL,
            blending: THREE.AdditiveBlending,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            toneMapped: false,
            fog: false,
            side: THREE.DoubleSide,
          }),
      ),
    [streakTex],
  );
  const quad = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(
    () => () => {
      quad.dispose();
      materials.forEach((m) => m.dispose());
      streakTex?.dispose();
    },
    [quad, materials, streakTex],
  );

  // Seed/track tab visibility so the loop pauses while hidden. We re-anchor the
  // meteor schedules on each resume so they don't immediately fire a backlog, and
  // wake the loop once on resume so twinkle picks back up.
  const visibleRef = useRef(!document.hidden);
  useEffect(() => {
    const onVisibility = () => {
      const visible = !document.hidden;
      visibleRef.current = visible;
      if (visible) {
        // Re-anchor the schedule relative to now (drop any while-hidden backlog).
        const now = performance.now();
        nextAts.current = nextAts.current.map(() => now + gap());
        invalidate(); // resume the demand loop → twinkle ticks again
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [invalidate]);

  // Fire a fresh streak from a pool slot: an origin on the upper star shell
  // BIASED toward where the camera is looking (so streaks actually cross the
  // visible frame instead of firing behind the view), a heading TANGENT to the
  // shell (mostly sideways, pulled downward — the classic shooting-star sweep)
  // and a randomised length/width/tint.
  const fireMeteor = (i: number, now: number, camera: THREE.Camera) => {
    const m = meteors.current[i];
    // View cone: the camera's look direction lifted toward the upper sky (the
    // surface camera often looks at the ground — streaks still belong overhead).
    camera.getWorldDirection(tmpCam);
    tmpCam.y = Math.max(tmpCam.y, 0.3);
    tmpCam.normalize();
    // Rejection-sample the upper hemisphere for a spawn within ~55° of the view
    // cone; fall back to the last sample so a worst-case fire still happens.
    for (let tries = 0; tries < 12; tries++) {
      const u = Math.random() * 0.9 + 0.05; // cos(theta) ∈ (0.05, 0.95): upper sky
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      m.origin.set(r * Math.cos(phi), u, r * Math.sin(phi));
      if (m.origin.dot(tmpCam) > 0.57) break; // within ~55° of the lifted view
    }
    m.origin.multiplyScalar(METEOR_SHELL);
    // Heading: random direction projected onto the shell's tangent plane (so the
    // streak slides ACROSS the sky, never toward the camera), then pulled toward
    // the local "down along the sky" tangent for the falling-star look.
    tmpN.copy(m.origin).normalize(); // radial out
    m.heading
      .set(Math.random() * 2 - 1, -(Math.random() * 0.6 + 0.2), Math.random() * 2 - 1)
      .addScaledVector(tmpN, -m.heading.dot(tmpN)) // strip the radial component
      .normalize();
    m.length = METEOR_LENGTH_MIN + Math.random() * (METEOR_LENGTH_MAX - METEOR_LENGTH_MIN);
    m.width = METEOR_WIDTH_MIN + Math.random() * (METEOR_WIDTH_MAX - METEOR_WIDTH_MIN);
    materials[i].color.copy(Math.random() < METEOR_WARM_CHANCE ? METEOR_WARM : METEOR_COOL);
    m.start = now;
    m.active = true;
  };

  useFrame(({ camera }) => {
    if (!visibleRef.current) return; // paused while the tab is hidden
    const now = performance.now();
    uTime.value = now / 1000;

    for (let i = 0; i < METEOR_POOL; i++) {
      // Schedule lazily (after mount) so nothing fires instantly; stagger the
      // slots so the pool doesn't sync up.
      if (nextAts.current[i] === 0) nextAts.current[i] = now + gap() * (i + 1) * 0.5;

      const m = meteors.current[i];
      if (!m.active && now >= nextAts.current[i]) {
        fireMeteor(i, now, camera);
        nextAts.current[i] = now + gap();
      }

      const mesh = meshRefs.current[i];
      if (m.active && mesh) {
        const t = (now - m.start) / METEOR_FADE_MS; // 0 → 1 over the streak's life
        if (t >= 1) {
          m.active = false;
          mesh.visible = false;
          materials[i].opacity = 0;
        } else {
          mesh.visible = true;
          // Slide along the heading; orient the quad: local +X = travel heading
          // (the texture's head points +X), local +Z = radial (tangent to the
          // shell, so the quad faces the camera region at the centre).
          mesh.position.copy(m.origin).addScaledVector(m.heading, t * METEOR_TRAVEL);
          tmpN.copy(mesh.position).normalize();
          tmpY.crossVectors(tmpN, m.heading).normalize();
          tmpZ.crossVectors(m.heading, tmpY).normalize();
          tmpM.makeBasis(m.heading, tmpY, tmpZ);
          mesh.quaternion.setFromRotationMatrix(tmpM);
          mesh.scale.set(m.length, m.width, 1);
          // Ease-out fade: bright at birth, gone by ~900ms.
          materials[i].opacity = METEOR_OPACITY * (1 - t) * (1 - t);
        }
      }
    }

    // Twinkle repaints every visible frame; active meteors keep it alive too.
    invalidate();
  });

  return (
    <>
      {materials.map((mat, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshRefs.current[i] = el;
          }}
          visible={false}
          geometry={quad}
          material={mat}
          raycast={() => null}
        />
      ))}
    </>
  );
}

export function SpaceEnvironment({ onSurface = false }: { onSurface?: boolean }) {
  // Shared twinkle clock: one stable uniform object read by the star shader patch
  // and mutated each frame by SkyAnimator. Created once so the material compiles
  // exactly once (no shader rebuilds).
  const [uTime] = useState(() => ({ value: 0 }));
  return (
    <>
      {/* Milky-Way 16k starmap on a camera-following inward sphere (imperative
          loader, black fallback). The sphere owns its per-view yaw/roll/pitch +
          brightness outright — nothing else touches them. */}
      <SkySphere onSurface={onSurface} />
      {/* Sparse foreground star points (per-vertex size/brightness/color),
          twinkled by the shared uTime clock (issue #106). */}
      <Starfield uTime={uTime} />
      {/* The single sky useFrame: drives twinkle + meteor streaks, pauses while
          the tab is hidden (issue #106). */}
      <SkyAnimator uTime={uTime} />
      {/* HDR under Suspense (never block paint) + error boundary (never blank).
          `onSurface` selects the per-view IBL grade (drei owns environmentIntensity). */}
      <EnvErrorBoundary>
        <Suspense fallback={null}>
          <HdrBackdrop onSurface={onSurface} />
        </Suspense>
      </EnvErrorBoundary>
    </>
  );
}
