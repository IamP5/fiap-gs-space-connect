// textureFidelity.test.ts — the texture crispness + colour-correctness sweep (#100).
//
// Two guarantees: (1) applyMaxAnisotropy stamps the GPU's max anisotropy onto any
// loaded texture; (2) applyGltfTextureFidelity walks a loaded glTF tree and fixes
// every material's maps — colour maps → sRGB, data maps → NoColorSpace +
// LinearMipmapNearestFilter, and ALL maps get max anisotropy.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyGltfTextureFidelity, applyMaxAnisotropy } from "./textureFidelity";

const MAX = 16;

// A bare texture stand-in (no decode needed): three's Texture defaults to
// anisotropy 1 and minFilter LinearMipmapLinearFilter.
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
  // Build a small loaded-glTF stand-in: a Group with two meshes, one carrying a
  // full PBR map set, the other a multi-material array, all maps fresh textures.
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
    // A multi-material mesh shares the same material so the traversal must handle
    // material arrays without throwing.
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
    // Colour maps keep their (trilinear) default filter — only data maps change.
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
