// textureCache — a tiny module-level, URL-keyed THREE.Texture cache so the
// preload pass (lib/assets.ts) and the in-scene consumers (SkyBodies, DecorRocks,
// LunarTerrain, the spec PBR maps) share ONE decoded texture per URL. Warming the
// cache up front behind the splash means the descent reuses already-decoded
// textures with no pop-in (Epic 05 P1).
//
// SEMANTICS (important):
//   • One Texture per URL, returned synchronously and memoised. The first caller
//     triggers the decode; later callers get the same object immediately and the
//     pixels appear once the load resolves (three flips `needsUpdate`).
//   • The cache OWNS the texture for the session — callers MUST NOT dispose() a
//     cached texture (that would free it for every other consumer and for a later
//     remount). The textures live until page unload, like the GLB caches.
//   • Per-URL config (colorSpace / wrap / anisotropy / repeat) is still applied by
//     each consumer at use. Each URL has a single consumer config and those passes
//     are idempotent, so sharing is safe (Epic 05 P1).
//   • GRACEFUL FALLBACK (ADR-0004): a failed load is swallowed — the returned
//     Texture simply never receives pixels, so the consumer's flat-colour fallback
//     holds. We never throw; preload counts a failed asset as done.

import * as THREE from "three";

// One shared loader for every cached image (TextureLoader has no per-instance
// state we need to vary).
const loader = new THREE.TextureLoader();

// URL → the single decoded Texture for that URL (created lazily on first request).
const cache = new Map<string, THREE.Texture>();

// URL → a promise that resolves once the underlying load SETTLES (success OR
// failure). preloadAllAssets awaits these so progress only ticks when a load is
// actually done; in-scene consumers ignore it and just read the Texture.
const loading = new Map<string, Promise<void>>();

/**
 * Return the memoised THREE.Texture for `url`, kicking off the decode on first
 * request. The same object is returned for every later call (so preload and the
 * scene share one decoded texture). NEVER dispose the returned texture — the cache
 * owns it for the session.
 */
export function loadTexture(url: string): THREE.Texture {
  const existing = cache.get(url);
  if (existing) return existing;

  // Create the Texture eagerly so callers get a stable object synchronously; the
  // loader fills in its image + flips needsUpdate when the decode resolves.
  const texture = new THREE.Texture();
  cache.set(url, texture);

  const promise = new Promise<void>((resolve) => {
    loader.load(
      url,
      (loaded) => {
        // Adopt the decoded image into the SAME texture object every consumer
        // already holds, then flag it for a GPU upload on next use.
        texture.image = loaded.image;
        texture.needsUpdate = true;
        // The freshly-created loader texture is now redundant; drop its GPU/source
        // refs (we copied the image out). It was never handed to a consumer.
        loaded.dispose();
        resolve();
      },
      undefined,
      () => {
        // Missing/failed (ADR-0004): leave the empty texture so the consumer's flat
        // fallback holds. SETTLE — preload must never reject on a per-asset failure.
        resolve();
      },
    );
  });
  loading.set(url, promise);
  return texture;
}

/**
 * Preload `url` into the cache and resolve once the load SETTLES (success OR
 * failure). Used by preloadAllAssets so the progress bar ticks per real load.
 */
export function preloadTexture(url: string): Promise<void> {
  loadTexture(url); // ensure the load is kicked off + memoised
  return loading.get(url) ?? Promise.resolve();
}

// Test-only: reset the module caches between tests.
export function __resetTextureCache(): void {
  cache.clear();
  loading.clear();
}
