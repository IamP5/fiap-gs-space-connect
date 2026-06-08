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

// --- Material tier polish (issue #111) --------------------------------------
//
// Make imported glTF structures read as real materials, not uniform polygons.
// This is the glTF half of #111 (the primitive dome tiers + DecorRocks PBR are
// done at their own call sites). Run ONCE on the CACHED SOURCE scene in each
// loader (before any clone), so every placement inherits the upgrade for free —
// clone(true) shares the materials and copies the per-mesh `layers` mask, so the
// emissive-window bloom flag rides along too. Cheap, static, idempotent.
//
// Three concerns, keyed off material/mesh names + metalness + the asset URL:
//
//   1. CLEARCOAT METAL. A material with metalness > 0.3 (the NASA/Kenney steel
//      structures) gets a thin clearcoat lacquer (clearcoat 0.5 / roughness 0.4)
//      for a factory-steel specular sheen. MeshStandardMaterial has no clearcoat,
//      so such materials are upgraded to MeshPhysicalMaterial in place.
//
//   2. SOLAR GLINT. When the asset URL names a solar panel (e.g.
//      /assets/models/solar-panel.glb), every material gets row-aligned
//      ANISOTROPY (metalness 0.8, roughness 0.3, anisotropy 0.6) for the brushed,
//      directional glint of a real photovoltaic array. Also a physical upgrade.
//      Keyed off the URL because the vendored panel's material is generically
//      named (PaletteMaterial001), so a name match alone would miss it.
//
//   3. EMISSIVE WINDOWS. A submesh OR material named `*window*` becomes a warm
//      emissive (#FFD8A0, intensity 0.2) and its mesh joins the bloom layer, so
//      habitat windows glow at distance. A no-op on assets without window
//      submeshes (the current vendored set has none) — the mechanism is latent
//      until such an asset ships, exactly the ADR-0004 graceful-fallback posture.
//
// MANDATORY FALLBACK (ADR-0004): a glTF that never loads keeps its primitive box,
// untouched by this pass; a loaded one is only ever made richer, never blanked.
const WINDOW_EMISSIVE = "#FFD8A0";

type PolishOpts = { bloomLayer: number; url?: string };

export function polishGltfMaterials<T extends THREE.Object3D>(
  root: T,
  opts: PolishOpts,
): T {
  const isSolar = !!opts.url && /solar|panel/i.test(opts.url);
  // WS-3 (#171): the rover GLB ships a flat low-poly PBR (the Quaternius atlas is
  // pruned in conditioning → a single untextured material). Left as-is it reads as
  // matte plastic. Pull roughness down + keep it metallic so the hard lunar sun
  // glints off the chassis as machined metal. (Matches both rover_robot + rassor.)
  const isRover = !!opts.url && /rover|rassor/i.test(opts.url);
  // A material can be SHARED across submeshes; upgrade each unique instance once,
  // reuse the result everywhere, and dispose the replaced originals once at the end
  // (dispose() frees only the material program — never the shared textures).
  const upgraded = new Map<THREE.Material, THREE.Material>();
  const toDispose = new Set<THREE.Material>();

  const polishOne = (
    mat: THREE.Material,
    nameWindow: boolean,
  ): { material: THREE.Material; window: boolean } => {
    const cached = upgraded.get(mat);
    if (cached) return { material: cached, window: cached.userData.__window === true };
    if (mat.userData.__polished) return { material: mat, window: mat.userData.__window === true };

    const std = mat as THREE.MeshStandardMaterial;
    const windowMatch = nameWindow || /window/i.test(mat.name);
    const metalish = typeof std.metalness === "number" && std.metalness > 0.3;
    const needsPhysical = isSolar || metalish;

    let out: THREE.MeshStandardMaterial = std;
    if (needsPhysical && !(mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const phys = new THREE.MeshPhysicalMaterial();
      phys.copy(std); // copies all standard props + MAP REFERENCES (not clones)
      toDispose.add(std);
      out = phys;
    }
    const phys = out as THREE.MeshPhysicalMaterial;

    if (isSolar) {
      phys.metalness = 0.8;
      phys.roughness = 0.3;
      phys.anisotropy = 0.6;
      phys.anisotropyRotation = 0; // rows run along U → a horizontal specular streak
    } else if (isRover && phys.isMeshPhysicalMaterial) {
      phys.metalness = 0.85;
      phys.roughness = 0.5; // was glTF-default 1.0 (matte) → now a machined-metal sheen
      phys.clearcoat = 0.6;
      phys.clearcoatRoughness = 0.35;
    } else if (metalish && phys.isMeshPhysicalMaterial) {
      phys.clearcoat = 0.5;
      phys.clearcoatRoughness = 0.4;
    }
    if (windowMatch) {
      out.emissive = new THREE.Color(WINDOW_EMISSIVE);
      out.emissiveIntensity = 0.2;
      out.userData.__window = true;
    }
    out.userData.__polished = true;
    out.needsUpdate = true;
    upgraded.set(mat, out);
    return { material: out, window: windowMatch };
  };

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const nameWindow = /window/i.test(mesh.name);
    let anyWindow = false;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => {
        const r = polishOne(m, nameWindow);
        anyWindow = anyWindow || r.window;
        return r.material;
      });
    } else {
      const r = polishOne(mesh.material, nameWindow);
      anyWindow = anyWindow || r.window;
      mesh.material = r.material;
    }
    // Windows ride the celestial bloom layer so they glow at distance (#111).
    if (anyWindow) mesh.layers.enable(opts.bloomLayer);
  });

  for (const m of toDispose) m.dispose();
  return root;
}
