
import * as THREE from "three";

export function applyMaxAnisotropy<T extends THREE.Texture | null>(
  texture: T,
  maxAnisotropy: number,
): T {
  if (texture) texture.anisotropy = maxAnisotropy;
  return texture;
}

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

function fixMaterial(material: THREE.Material, maxAnisotropy: number): void {
  const mat = material as THREE.MeshStandardMaterial;
  let touched = false;

  const apply = (key: MapKey, colorSpace: THREE.ColorSpace, data: boolean) => {
    const tex = mat[key] as THREE.Texture | null | undefined;
    if (!tex) return;
    tex.colorSpace = colorSpace;
    tex.anisotropy = maxAnisotropy;
    if (data) {
      tex.minFilter = THREE.LinearMipmapNearestFilter;
    }
    tex.needsUpdate = true;
    touched = true;
  };

  for (const key of COLOR_MAP_KEYS) apply(key, THREE.SRGBColorSpace, false);
  for (const key of DATA_MAP_KEYS) apply(key, THREE.NoColorSpace, true);

  if (touched) mat.needsUpdate = true;
}

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

const WINDOW_EMISSIVE = "#FFD8A0";

type PolishOpts = { bloomLayer: number; url?: string };

export function polishGltfMaterials<T extends THREE.Object3D>(
  root: T,
  opts: PolishOpts,
): T {
  const isSolar = !!opts.url && /solar|panel/i.test(opts.url);
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
    const isStandard = (std as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
    const metalish = isStandard && typeof std.metalness === "number" && std.metalness > 0.3;
    const needsPhysical = isStandard && (isSolar || metalish);

    let out: THREE.MeshStandardMaterial = std;
    if (needsPhysical && !(mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
      const phys = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(phys, std);
      toDispose.add(std);
      out = phys;
    }
    const phys = out as THREE.MeshPhysicalMaterial;

    if (isSolar && phys.isMeshPhysicalMaterial) {
      phys.metalness = 0.8;
      phys.roughness = 0.3;
      phys.anisotropy = 0.6;
      phys.anisotropyRotation = 0;
    } else if (metalish && phys.isMeshPhysicalMaterial) {
      phys.clearcoat = 0.5;
      phys.clearcoatRoughness = 0.4;
    }
    if (windowMatch && isStandard) {
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
    if (anyWindow) mesh.layers.enable(opts.bloomLayer);
  });

  for (const m of toDispose) m.dispose();
  return root;
}
