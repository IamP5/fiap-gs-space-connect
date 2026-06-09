
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyGltfTextureFidelity,
  applyMaxAnisotropy,
  polishGltfMaterials,
} from "./textureFidelity";

const MAX = 16;

function tex(): THREE.Texture {
  return new THREE.Texture();
}

describe("applyMaxAnisotropy", () => {
  it("stamps the given anisotropy onto a texture", () => {
    const t = tex();
    expect(applyMaxAnisotropy(t, MAX)).toBe(t);
    expect(t.anisotropy).toBe(MAX);
  });

  it("is a no-op (and returns null) for a null texture", () => {
    expect(applyMaxAnisotropy(null, MAX)).toBeNull();
  });
});

describe("applyGltfTextureFidelity", () => {
  function fakeGltf(): {
    root: THREE.Group;
    mat: THREE.MeshStandardMaterial;
    maps: Record<string, THREE.Texture>;
  } {
    const maps = {
      map: tex(),
      emissiveMap: tex(),
      normalMap: tex(),
      roughnessMap: tex(),
      metalnessMap: tex(),
      aoMap: tex(),
    };
    const mat = new THREE.MeshStandardMaterial();
    mat.map = maps.map;
    mat.emissiveMap = maps.emissiveMap;
    mat.normalMap = maps.normalMap;
    mat.roughnessMap = maps.roughnessMap;
    mat.metalnessMap = maps.metalnessMap;
    mat.aoMap = maps.aoMap;

    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), mat));
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [mat, mat]);
    root.add(multi);
    return { root, mat, maps };
  }

  it("sets max anisotropy on every map", () => {
    const { root, maps } = fakeGltf();
    applyGltfTextureFidelity(root, MAX);
    for (const t of Object.values(maps)) expect(t.anisotropy).toBe(MAX);
  });

  it("sets colour maps to sRGB and data maps to NoColorSpace", () => {
    const { root, maps } = fakeGltf();
    applyGltfTextureFidelity(root, MAX);
    expect(maps.map.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(maps.emissiveMap.colorSpace).toBe(THREE.SRGBColorSpace);
    for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
      expect(maps[key].colorSpace).toBe(THREE.NoColorSpace);
    }
  });

  it("sets data maps to LinearMipmapNearestFilter, leaving colour maps' filter", () => {
    const { root, maps } = fakeGltf();
    const colourBefore = maps.map.minFilter;
    applyGltfTextureFidelity(root, MAX);
    for (const key of ["normalMap", "roughnessMap", "metalnessMap", "aoMap"]) {
      expect(maps[key].minFilter).toBe(THREE.LinearMipmapNearestFilter);
    }
    expect(maps.map.minFilter).toBe(colourBefore);
  });

  it("returns the root and skips meshes with no material (no throw)", () => {
    const root = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry());
    // @ts-expect-error — force the no-material edge case the guard must tolerate.
    m.material = undefined;
    root.add(m);
    expect(applyGltfTextureFidelity(root, MAX)).toBe(root);
  });
});

describe("polishGltfMaterials", () => {
  const BLOOM = 5;

  it("upgrades a non-physical metal material to physical without throwing", () => {
    const std = new THREE.MeshStandardMaterial();
    std.metalness = 0.9;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), std);
    const root = new THREE.Group().add(mesh);

    expect(() => polishGltfMaterials(root, { bloomLayer: BLOOM })).not.toThrow();

    const out = mesh.material as THREE.MeshPhysicalMaterial;
    expect(out.isMeshPhysicalMaterial).toBe(true);
    expect(out.metalness).toBe(0.9);
    expect(out.clearcoat).toBe(0.5);
    expect(out.clearcoatNormalScale.x).toBe(1);
  });

  it("leaves a low-metalness standard material as standard (no upgrade)", () => {
    const std = new THREE.MeshStandardMaterial();
    std.metalness = 0.1;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), std);
    const root = new THREE.Group().add(mesh);

    polishGltfMaterials(root, { bloomLayer: BLOOM });
    expect((mesh.material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial).toBeFalsy();
  });

  it("leaves a non-standard (unlit) material alone on a solar URL — no throw", () => {
    const basic = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), basic);
    const root = new THREE.Group().add(mesh);

    expect(() =>
      polishGltfMaterials(root, { bloomLayer: BLOOM, url: "/assets/models/solar-panel.glb" }),
    ).not.toThrow();
    expect((mesh.material as THREE.MeshBasicMaterial).isMeshBasicMaterial).toBe(true);
  });

  it("upgrades a standard material on a solar URL and applies anisotropic glint", () => {
    const std = new THREE.MeshStandardMaterial();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), std);
    const root = new THREE.Group().add(mesh);

    polishGltfMaterials(root, { bloomLayer: BLOOM, url: "/assets/models/solar-panel.glb" });
    const out = mesh.material as THREE.MeshPhysicalMaterial;
    expect(out.isMeshPhysicalMaterial).toBe(true);
    expect(out.anisotropy).toBe(0.6);
    expect(out.metalness).toBe(0.8);
  });
});
