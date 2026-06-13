
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";

import { preloadTexture } from "./textureCache";
import { reportAssetWarning } from "./assetLog";
import { ROVER_MODEL_REF, REGOLITH_MAPS, loadGLTF } from "../components/Scene3D";
import { SCENERY_MODEL_REFS, loadScenery } from "../components/LaunchScenery";
import { HDR_FILE, STAR_BG_FILE, STAR_BG_KTX2 } from "../components/SpaceEnvironment";
import {
  MOON_COLOR,
  MOON_NORMAL,
  EARTH_DAY,
  EARTH_NIGHT,
  EARTH_CLOUDS,
  SUN_COLOR,
  NEBULA_VEIL,
} from "../components/SkyBodies";
import { ROCK_DIFF, ROCK_NORMAL, ROCK_ROUGH } from "../components/LavaTube";
import { STRUCTURE_TEXTURES } from "../components/Structures";


export const GLB_ASSETS: readonly string[] = [
  ROVER_MODEL_REF,
  ...SCENERY_MODEL_REFS,
];

export const TEXTURE_ASSETS: readonly string[] = [
  MOON_COLOR,
  MOON_NORMAL,
  EARTH_DAY,
  EARTH_NIGHT,
  EARTH_CLOUDS,
  SUN_COLOR,
  NEBULA_VEIL,
  STAR_BG_FILE,
  ...REGOLITH_MAPS.map((m) => m.url),
  ROCK_DIFF,
  ROCK_NORMAL,
  ROCK_ROUGH,
  ...STRUCTURE_TEXTURES,
];

export const HDR_ASSETS: readonly string[] = [HDR_FILE];

export const BINARY_ASSETS: readonly string[] = [STAR_BG_KTX2];

export const ALL_ASSETS: readonly string[] = Array.from(
  new Set<string>([...GLB_ASSETS, ...TEXTURE_ASSETS, ...HDR_ASSETS, ...BINARY_ASSETS]),
);


const rgbeLoader = new RGBELoader();

function preloadGLB(url: string): Promise<void> {
  const loader = SCENERY_MODEL_REFS.includes(url) ? loadScenery : loadGLTF;
  return loader(url).then(
    () => undefined,
    (err) => {
      reportAssetWarning("preload glTF", url, err);
    },
  );
}

function preloadHDR(url: string): Promise<void> {
  return new Promise<void>((resolve) => {
    rgbeLoader.load(
      url,
      (tex) => {
        tex.dispose();
        resolve();
      },
      undefined,
      (err) => {
        reportAssetWarning("HDR environment", url, err);
        resolve();
      },
    );
  });
}

function preloadBinary(url: string): Promise<void> {
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .then(
      () => undefined,
      (err) => reportAssetWarning("binary", url, err),
    );
}

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
    ...BINARY_ASSETS.map((url) => preloadBinary(url).then(tick)),
  ];

  onProgress(0, total);
  return Promise.all(tasks).then(() => undefined);
}
