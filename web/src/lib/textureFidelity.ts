// textureFidelity — a shared crispness + colour-correctness sweep applied to
// EVERY loaded texture in the scene (issue #100). Two concerns, one helper:
//
//   1. ANISOTROPY. Every loaded texture gets the GPU's max anisotropy
//      (gl.capabilities.getMaxAnisotropy()), so grazing-angle surfaces — the
//      terrain to the horizon, a rock's far flank, a glTF panel seen edge-on —
//      stay sharp instead of smearing. The terrain/Moon/Earth already did this
//      ad hoc; this centralises it so glTF imports and DecorRocks get it too.
//      Free at idle: anisotropy is a per-texture sampler hint, no per-frame work.
//
//   2. glTF MATERIAL AUDIT. Imported glTF materials frequently arrive with the
//      wrong texture colourSpace (drei/three do NOT always tag them on 0.169),
//      which renders the model dark/desaturated. We walk the loaded tree and fix
//      it per channel: base-colour + emissive maps are sRGB colour data; the
//      data maps (normal / roughness / metalness / AO) are linear (NoColorSpace).
//      Data maps additionally get LinearMipmapNearestFilter so distant mip levels
//      stay crisp (the per-mip detail in a normal/rough map should not cross-fade
//      to mush the way a colour map can).
//
// Demand-loop safe: pure one-shot mutation of already-loaded textures/materials.
// Callers flip material.needsUpdate / invalidate() once after, exactly as they
// already do for their own texture loads.

import * as THREE from "three";

// Apply the GPU's max anisotropy to a single already-loaded texture. A no-op if
// the texture is null. Returns the texture for convenient chaining.
export function applyMaxAnisotropy<T extends THREE.Texture | null>(
  texture: T,
  maxAnisotropy: number,
): T {
  if (texture) texture.anisotropy = maxAnisotropy;
  return texture;
}

// The standard-PBR map slots we audit on a glTF material, grouped by colour kind.
// COLOUR maps carry sRGB-encoded colour; DATA maps carry linear, per-texel values
// (vectors / scalars) that must NOT be sRGB-decoded or they skew the lighting.
const COLOR_MAP_KEYS = ["map", "emissiveMap"] as const;
const DATA_MAP_KEYS = [
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
] as const;

type MapKey =
  | (typeof COLOR_MAP_KEYS)[number]
  | (typeof DATA_MAP_KEYS)[number];

// Fix one material's textures in place: set each present map's colourSpace by
// kind, give every map max anisotropy, and set data maps to
// LinearMipmapNearestFilter. Marks the material needsUpdate iff it touched a map.
function fixMaterial(material: THREE.Material, maxAnisotropy: number): void {
  // The standard/physical map slots all live on MeshStandardMaterial; reading
  // through that type is safe for any material that simply lacks a given slot
  // (the field is just undefined, so the guard below skips it).
  const mat = material as THREE.MeshStandardMaterial;
  let touched = false;

  const apply = (key: MapKey, colorSpace: THREE.ColorSpace, data: boolean) => {
    const tex = mat[key] as THREE.Texture | null | undefined;
    if (!tex) return;
    tex.colorSpace = colorSpace;
    tex.anisotropy = maxAnisotropy;
    if (data) {
      // Crisp per-mip data detail at distance: nearest mip, linear within it.
      tex.minFilter = THREE.LinearMipmapNearestFilter;
    }
    tex.needsUpdate = true;
    touched = true;
  };

  for (const key of COLOR_MAP_KEYS) apply(key, THREE.SRGBColorSpace, false);
  for (const key of DATA_MAP_KEYS) apply(key, THREE.NoColorSpace, true);

  if (touched) mat.needsUpdate = true;
}

// Walk a loaded glTF scene and apply the full fidelity pass to every mesh
// material it carries (single or multi-material). Returns the root for chaining.
// Idempotent — safe to run on a cached source AND on per-placement clones (the
// clones share materials with the source, so the fixes simply re-assert).
export function applyGltfTextureFidelity<T extends THREE.Object3D>(
  root: T,
  maxAnisotropy: number,
): T {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) fixMaterial(m, maxAnisotropy);
  });
  return root;
}
