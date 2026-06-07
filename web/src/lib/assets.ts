// assets — the central preload manifest + preloadAllAssets (Epic 05 P1).
//
// THE PROBLEM: the worksite assets (rover GLB, the 6 launch-scenery GLBs, the
// regolith/decor PBR textures) mount only under {onSurface && …}, so in the default
// orbit view they NEVER load — a "wait for what mounts" approach would wait for the
// orbit set only, not "everything". So the user's "load truly all, then reveal"
// choice needs an EXPLICIT manifest of every asset URL, gathered here.
//
// NO GL CONTEXT NEEDED: TextureLoader / GLTFLoader (+DRACO/meshopt) / RGBELoader
// all fetch + decode without a renderer (the GPU upload happens lazily on first
// use), so preload completes BEFORE the Canvas mounts — a literal "load all, then
// initialize". This sidesteps drei useProgress's 0/0-is-100 first-frame race.
//
// DRIFT-PROOF: every URL is imported from the module that renders it (Scene3D,
// LaunchScenery, SpaceEnvironment, SkyBodies, DecorRocks export their constants),
// so the manifest can't fall out of sync. assets.test.ts asserts non-empty + no
// dupes.
//
// ADR-0004: a per-asset failure is TOLERATED — preloadAllAssets settles on all,
// counting a failed asset as done, and NEVER rejects. The LoadingScreen's safety
// timeout is the backstop if a load hangs entirely. In-scene primitive/box
// fallbacks still cover any asset that never arrives.
//
// CACHE WARMING: GLBs are preloaded through the EXPORTED module-level loaders
// (loadGLTF / loadScenery), which warm the gltfCache / sceneryCache, so the descent
// reuses the already-decoded models with zero rework. Textures are preloaded
// through the shared textureCache, so preload and the surface components share one
// decoded texture (no pop-in).

import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { preloadTexture } from "./textureCache";
import { ROVER_MODEL_REF, REGOLITH_MAPS, loadGLTF } from "../components/Scene3D";
import { SCENERY_MODEL_REFS, loadScenery } from "../components/LaunchScenery";
import { HDR_FILE, STAR_BG_FILE } from "../components/SpaceEnvironment";
import {
  MOON_COLOR,
  MOON_NORMAL,
  EARTH_DAY,
  EARTH_NIGHT,
  EARTH_CLOUDS,
  SUN_COLOR,
  NEBULA_VEIL,
} from "../components/SkyBodies";
import { ROCK_DIFF, ROCK_NORMAL, ROCK_ROUGH } from "../components/DecorRocks";

// --- the manifest, partitioned by loader -----------------------------------

// glTF models — warmed through the EXPORTED module-level caches (loadGLTF warms
// Scene3D's gltfCache; loadScenery warms LaunchScenery's sceneryCache) so the
// descent reuses the decoded models.
export const GLB_ASSETS: readonly string[] = [
  ROVER_MODEL_REF,
  ...SCENERY_MODEL_REFS,
];

// Equirectangular / image textures — warmed through the shared textureCache so the
// in-scene consumers read the SAME decoded texture (no pop-in).
export const TEXTURE_ASSETS: readonly string[] = [
  // celestial bodies (orbit-visible)
  MOON_COLOR,
  MOON_NORMAL,
  EARTH_DAY,
  EARTH_NIGHT,
  EARTH_CLOUDS,
  SUN_COLOR,
  NEBULA_VEIL,
  // deep-space backdrop (orbit-visible)
  STAR_BG_FILE,
  // surface worksite (mounts only under onSurface — preloaded so the descent is crisp)
  ...REGOLITH_MAPS.map((m) => m.url),
  ROCK_DIFF,
  ROCK_NORMAL,
  ROCK_ROUGH,
];

// HDR environment maps — loaded with RGBELoader (the .hdr decoder). IBL only.
export const HDR_ASSETS: readonly string[] = [HDR_FILE];

// The flat list of every asset URL (deduped). Exported so assets.test.ts can
// assert it is non-empty and free of duplicate URLs.
export const ALL_ASSETS: readonly string[] = Array.from(
  new Set<string>([...GLB_ASSETS, ...TEXTURE_ASSETS, ...HDR_ASSETS]),
);

// --- per-loader preloaders (each SETTLES — never rejects, ADR-0004) ---------

// One shared RGBELoader for the .hdr(s).
const rgbeLoader = new RGBELoader();

function preloadGLB(url: string): Promise<void> {
  // loadGLTF/loadScenery already memoise + swallow nothing; we catch here so a
  // failed model counts as done and never rejects the batch.
  const loader = SCENERY_MODEL_REFS.includes(url) ? loadScenery : loadGLTF;
  return loader(url).then(
    () => undefined,
    () => undefined, // ADR-0004: a failed model keeps its in-scene box fallback
  );
}

function preloadHDR(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    rgbeLoader.load(
      url,
      (tex) => {
        // We only need the .hdr DECODED into the browser cache so drei's
        // <Environment files> resolves instantly later; we don't keep this texture
        // (drei loads its own via useLoader). Drop our copy.
        tex.dispose();
        resolve();
      },
      undefined,
      () => resolve(), // ADR-0004: a failed HDR → the error boundary keeps the scene
    );
  });
}

/**
 * Preload EVERY asset behind the splash. Calls `onProgress(loaded, total)` after
 * each asset SETTLES (success or failure). Resolves once all have settled; NEVER
 * rejects — a per-asset failure counts as done (ADR-0004). The caller (LoadingScreen)
 * additionally arms a safety timeout so a hung load can't block the reveal forever.
 */
export function preloadAllAssets(
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const total = ALL_ASSETS.length;
  let loaded = 0;
  const tick = () => {
    loaded += 1;
    onProgress(loaded, total);
  };

  const tasks: Promise<void>[] = [
    ...GLB_ASSETS.map((url) => preloadGLB(url).then(tick)),
    ...TEXTURE_ASSETS.map((url) => preloadTexture(url).then(tick)),
    ...HDR_ASSETS.map((url) => preloadHDR(url).then(tick)),
  ];

  // Report the initial 0/total so the bar renders immediately (before the first
  // settle), then resolve once every task has settled.
  onProgress(0, total);
  return Promise.all(tasks).then(() => undefined);
}
