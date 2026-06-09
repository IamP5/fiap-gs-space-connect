
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

export const HDR_FILE = "/assets/hdr/moonless_golf_2k.hdr";

export const STAR_BG_FILE = "/assets/starmap_2020_8k_gal.jpg";

export const STAR_BG_KTX2 = "/assets/starmap_2020_16k_gal.ktx2";

let ktx2Loader: KTX2Loader | null = null;
function getKTX2Loader(gl: THREE.WebGLRenderer): KTX2Loader {
  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader().setTranscoderPath("/assets/basis/").detectSupport(gl);
  }
  return ktx2Loader;
}

const SKY_PITCH_DEG = 25;
const SKY_ROLL_DEG = 18;
const SKY_YAW_ORBIT_DEG = 0;
const SKY_YAW_SURFACE_DEG = -74;

function skyQuaternionFor(onSurface: boolean): THREE.Quaternion {
  const e = new THREE.Euler(
    THREE.MathUtils.degToRad(SKY_PITCH_DEG),
    THREE.MathUtils.degToRad(onSurface ? SKY_YAW_SURFACE_DEG : SKY_YAW_ORBIT_DEG),
    THREE.MathUtils.degToRad(SKY_ROLL_DEG),
  );
  return new THREE.Quaternion().setFromEuler(e);
}
const STAR_BG_INTENSITY_ORBIT = 0.9;
const STAR_BG_INTENSITY_SURFACE = 1.08;

const SKY_SPHERE_RADIUS = 7000;
const SKY_SPHERE_RENDER_ORDER = -100;

const ENV_INTENSITY_SURFACE = 1.0;
const ENV_INTENSITY_ORBIT = 0.05;

const STAR_COUNT = 2800;
const STAR_SHELL_RADIUS = 4000;

const STAR_BASE_SIZE = 1.4;

const TWINKLE_FREQ_MIN = 0.6;
const TWINKLE_FREQ_MAX = 2.2;

const METEOR_POOL = 2;
const METEOR_FADE_MS = 900;
const METEOR_MIN_GAP_MS = 2800;
const METEOR_MAX_GAP_MS = 7500;
const METEOR_LENGTH_MIN = 380;
const METEOR_LENGTH_MAX = 680;
const METEOR_WIDTH_MIN = 9;
const METEOR_WIDTH_MAX = 16;
const METEOR_TRAVEL = 900;
const METEOR_SHELL = STAR_SHELL_RADIUS * 0.92;
const METEOR_OPACITY = 0.85;
const METEOR_COOL = new THREE.Color("#dfe9ff");
const METEOR_WARM = new THREE.Color("#ffdfb8");
const METEOR_WARM_CHANCE = 0.15;

class EnvErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function SkySphere({ onSurface }: { onSurface: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const meshRef = useRef<THREE.Mesh>(null);

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
      invalidate();
    };

    const installJpgFallback = () => {
      const jpg = loadTexture(STAR_BG_FILE);
      void preloadTexture(STAR_BG_FILE).then(() => {
        if (cancelled || !jpg.image) return;
        jpg.generateMipmaps = true;
        jpg.minFilter = THREE.LinearMipmapLinearFilter;
        jpg.magFilter = THREE.LinearFilter;
        install(jpg, false);
      });
    };

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
      ownedRef.current?.dispose();
      ownedRef.current = null;
    };
  }, [gl, invalidate]);

  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(SKY_SPHERE_RADIUS, 96, 48);
    g.scale(-1, 1, 1);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const quaternion = useMemo(() => skyQuaternionFor(onSurface), [onSurface]);
  const tint = useMemo(
    () =>
      new THREE.Color().setScalar(
        onSurface ? STAR_BG_INTENSITY_SURFACE : STAR_BG_INTENSITY_ORBIT,
      ),
    [onSurface],
  );
  useEffect(() => {
    invalidate();
  }, [onSurface, invalidate]);

  useFrame(({ camera }) => {
    meshRef.current?.position.copy(camera.position);
  });

  if (!tex) return null;

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

function HdrBackdrop({ onSurface }: { onSurface: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
  }, [invalidate]);
  return (
    <Environment
      files={HDR_FILE}
      environmentIntensity={onSurface ? ENV_INTENSITY_SURFACE : ENV_INTENSITY_ORBIT}
    />
  );
}

const WARM_STAR = new THREE.Color("#ffd8b0");
const COOL_STAR = new THREE.Color("#cfe0ff");
const WHITE_STAR = new THREE.Color("#ffffff");

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
      const u = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const x = r * Math.cos(phi);
      const y = u;
      const z = r * Math.sin(phi);
      positions[i * 3] = x * STAR_SHELL_RADIUS;
      positions[i * 3 + 1] = y * STAR_SHELL_RADIUS;
      positions[i * 3 + 2] = z * STAR_SHELL_RADIUS;

      const t = Math.pow(Math.random(), 3);
      sizes[i] = STAR_BASE_SIZE * (0.45 + t * 1.3);
      const brightness = 0.4 + t * 0.4;

      const c = Math.random();
      const base = c < 0.06 ? WARM_STAR : c < 0.1 ? COOL_STAR : WHITE_STAR;
      tmp.copy(base).multiplyScalar(brightness);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;

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

  const material = useMemo(() => {
    const m = new THREE.PointsMaterial({
      vertexColors: true,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader =
        "attribute float aSize;\n" +
        "attribute float aPhase;\n" +
        "attribute float aFreq;\n" +
        "uniform float uTime;\n" +
        shader.vertexShader.replace(
          "gl_PointSize = size;",
          "gl_PointSize = aSize * (0.7 + 0.3 * sin(uTime * aFreq + aPhase));",
        );
    };
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

type MeteorState = {
  active: boolean;
  start: number;
  origin: THREE.Vector3;
  heading: THREE.Vector3;
  length: number;
  width: number;
};

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
  const HEAD_X = 0.86;
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5) / h - 0.5;
    const vert = Math.exp(-(dy * dy) / (2 * 0.16 * 0.16));
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const tail =
        u <= HEAD_X
          ? Math.pow(u / HEAD_X, 2.6)
          : Math.max(0, 1 - (u - HEAD_X) / (1 - HEAD_X));
      const dxh = (u - HEAD_X) / 0.05;
      const core = 1.6 * Math.exp(-(dxh * dxh + (dy / 0.1) * (dy / 0.1)));
      const v = Math.min(1, tail * vert + core);
      const i = (y * w + x) * 4;
      const c = Math.round(v * 255);
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = c;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function SkyAnimator({ uTime }: { uTime: { value: number } }) {
  const invalidate = useThree((s) => s.invalidate);
  const meshRefs = useRef<(THREE.Mesh | null)[]>(Array(METEOR_POOL).fill(null));

  const tmpN = useMemo(() => new THREE.Vector3(), []);
  const tmpY = useMemo(() => new THREE.Vector3(), []);
  const tmpZ = useMemo(() => new THREE.Vector3(), []);
  const tmpCam = useMemo(() => new THREE.Vector3(), []);
  const tmpM = useMemo(() => new THREE.Matrix4(), []);

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

  const visibleRef = useRef(!document.hidden);
  useEffect(() => {
    const onVisibility = () => {
      const visible = !document.hidden;
      visibleRef.current = visible;
      if (visible) {
        const now = performance.now();
        nextAts.current = nextAts.current.map(() => now + gap());
        invalidate();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [invalidate]);

  const fireMeteor = (i: number, now: number, camera: THREE.Camera) => {
    const m = meteors.current[i];
    camera.getWorldDirection(tmpCam);
    tmpCam.y = Math.max(tmpCam.y, 0.3);
    tmpCam.normalize();
    for (let tries = 0; tries < 12; tries++) {
      const u = Math.random() * 0.9 + 0.05;
      const phi = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      m.origin.set(r * Math.cos(phi), u, r * Math.sin(phi));
      if (m.origin.dot(tmpCam) > 0.57) break;
    }
    m.origin.multiplyScalar(METEOR_SHELL);
    tmpN.copy(m.origin).normalize();
    m.heading
      .set(Math.random() * 2 - 1, -(Math.random() * 0.6 + 0.2), Math.random() * 2 - 1)
      .addScaledVector(tmpN, -m.heading.dot(tmpN))
      .normalize();
    m.length = METEOR_LENGTH_MIN + Math.random() * (METEOR_LENGTH_MAX - METEOR_LENGTH_MIN);
    m.width = METEOR_WIDTH_MIN + Math.random() * (METEOR_WIDTH_MAX - METEOR_WIDTH_MIN);
    materials[i].color.copy(Math.random() < METEOR_WARM_CHANCE ? METEOR_WARM : METEOR_COOL);
    m.start = now;
    m.active = true;
  };

  useFrame(({ camera }) => {
    if (!visibleRef.current) return;
    const now = performance.now();
    uTime.value = now / 1000;

    for (let i = 0; i < METEOR_POOL; i++) {
      if (nextAts.current[i] === 0) nextAts.current[i] = now + gap() * (i + 1) * 0.5;

      const m = meteors.current[i];
      if (!m.active && now >= nextAts.current[i]) {
        fireMeteor(i, now, camera);
        nextAts.current[i] = now + gap();
      }

      const mesh = meshRefs.current[i];
      if (m.active && mesh) {
        const t = (now - m.start) / METEOR_FADE_MS;
        if (t >= 1) {
          m.active = false;
          mesh.visible = false;
          materials[i].opacity = 0;
        } else {
          mesh.visible = true;
          mesh.position.copy(m.origin).addScaledVector(m.heading, t * METEOR_TRAVEL);
          tmpN.copy(mesh.position).normalize();
          tmpY.crossVectors(tmpN, m.heading).normalize();
          tmpZ.crossVectors(m.heading, tmpY).normalize();
          tmpM.makeBasis(m.heading, tmpY, tmpZ);
          mesh.quaternion.setFromRotationMatrix(tmpM);
          mesh.scale.set(m.length, m.width, 1);
          materials[i].opacity = METEOR_OPACITY * (1 - t) * (1 - t);
        }
      }
    }

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
  const [uTime] = useState(() => ({ value: 0 }));
  return (
    <>
      <SkySphere onSurface={onSurface} />
      <Starfield uTime={uTime} />
      <SkyAnimator uTime={uTime} />
      <EnvErrorBoundary>
        <Suspense fallback={null}>
          <HdrBackdrop onSurface={onSurface} />
        </Suspense>
      </EnvErrorBoundary>
    </>
  );
}
