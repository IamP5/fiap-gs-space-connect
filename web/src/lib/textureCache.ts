
import * as THREE from "three";
import { reportAssetWarning } from "./assetLog";

const loader = new THREE.TextureLoader();

const cache = new Map<string, THREE.Texture>();

const loading = new Map<string, Promise<void>>();

export function loadTexture(url: string): THREE.Texture {
  const existing = cache.get(url);
  if (existing) return existing;

  const texture = new THREE.Texture();
  cache.set(url, texture);

  const promise = new Promise<void>((resolve) => {
    loader.load(
      url,
      (loaded) => {
        texture.image = loaded.image;
        texture.needsUpdate = true;
        loaded.dispose();
        resolve();
      },
      undefined,
      (err) => {
        reportAssetWarning("texture", url, err);
        resolve();
      },
    );
  });
  loading.set(url, promise);
  return texture;
}

export function preloadTexture(url: string): Promise<void> {
  loadTexture(url);
  return loading.get(url) ?? Promise.resolve();
}

export function __resetTextureCache(): void {
  cache.clear();
  loading.clear();
}
