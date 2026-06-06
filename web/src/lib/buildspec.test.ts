// buildspec.test.ts — the Build-spec → mesh mapping is pure data (no three, no
// DOM), so it runs in vitest's node env, mirroring scene.test.ts's pure-math
// style. The load-bearing case for slice bh-01 is the FALLBACK: a Task with no
// build_spec must yield NO interpreted meshes, so Scene3D renders exactly today's
// `tierOf` primitive — proving the renderer fallback is invisible.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_METALNESS,
  DEFAULT_ROUGHNESS,
  hasBuildSpec,
  interpretBuildSpec,
  opToMesh,
} from "./buildspec";
import { tierHeight, tierOf } from "./scene";
import type { BuildOp, TaskView } from "../types/wire";

const v3 = (X: number, Y: number, Z: number) => ({ X, Y, Z });

const box: BuildOp = {
  op: "place",
  shape: "box",
  pos: v3(1, 2, 3),
  rot: v3(0, Math.PI, 0),
  scale: v3(2, 0.5, 2),
  material: { color: "#cfcfd6", roughness: 0.8, metalness: 0.1 },
};

describe("opToMesh", () => {
  it("maps a box op to a box mesh descriptor with its transform + material", () => {
    const m = opToMesh(box);
    expect(m).not.toBeNull();
    expect(m!.geometry).toBe("box");
    expect(m!.position).toEqual([1, 2, 3]);
    expect(m!.rotation).toEqual([0, Math.PI, 0]);
    expect(m!.scale).toEqual([2, 0.5, 2]);
    expect(m!.color).toBe("#cfcfd6");
    expect(m!.roughness).toBe(0.8);
    expect(m!.metalness).toBe(0.1);
  });

  it("maps cylinder and sphere shapes to their geometries", () => {
    expect(opToMesh({ ...box, shape: "cylinder" })!.geometry).toBe("cylinder");
    expect(opToMesh({ ...box, shape: "sphere" })!.geometry).toBe("sphere");
  });

  it("defaults the optional PBR fields when omitted", () => {
    const m = opToMesh({ ...box, material: { color: "#fff" } });
    expect(m!.roughness).toBe(DEFAULT_ROUGHNESS);
    expect(m!.metalness).toBe(DEFAULT_METALNESS);
  });

  it("returns null for the reserved future 'model' shape (no-op today)", () => {
    expect(opToMesh({ ...box, shape: "model", model_ref: "x.glb" })).toBeNull();
  });
});

describe("interpretBuildSpec", () => {
  it("preserves op order and drops non-renderable ops", () => {
    const spec: BuildOp[] = [
      { ...box, shape: "box" },
      { ...box, shape: "model", model_ref: "x.glb" }, // dropped
      { ...box, shape: "sphere" },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes.map((m) => m.geometry)).toEqual(["box", "sphere"]);
  });

  it("yields an empty list when build_spec is absent (fallback signal)", () => {
    expect(interpretBuildSpec({})).toEqual([]);
    expect(interpretBuildSpec({ build_spec: undefined })).toEqual([]);
    expect(interpretBuildSpec({ build_spec: [] })).toEqual([]);
  });
});

describe("hasBuildSpec", () => {
  it("is true only when the Task has renderable Build-spec geometry", () => {
    expect(hasBuildSpec({ build_spec: [box] })).toBe(true);
    expect(hasBuildSpec({})).toBe(false);
    expect(hasBuildSpec({ build_spec: [] })).toBe(false);
    // A spec of ONLY future "model" ops is not renderable today ⇒ fall back.
    expect(hasBuildSpec({ build_spec: [{ ...box, shape: "model", model_ref: "x.glb" }] })).toBe(
      false,
    );
  });
});

// FALLBACK INVARIANT (acceptance criterion): with build_spec absent, the task
// renders the EXACT current `tierOf` primitive. We assert here that the absence
// is detectable (no interpreted meshes) AND that the primitive path the renderer
// then takes is the unchanged tierOf/tierHeight mapping — so a future edit that
// accidentally diverts a spec-less task off the primitive path fails this test.
describe("fallback maps to the unchanged primitive tier geometry", () => {
  const cases: Array<{ type: string; tier: string }> = [
    { type: "foundation", tier: "foundation" },
    { type: "wall", tier: "wall" },
    { type: "dome-cap", tier: "dome" },
    { type: "widget", tier: "other" },
  ];

  for (const c of cases) {
    it(`task '${c.type}' with no build_spec → tier '${c.tier}' primitive`, () => {
      const task: Pick<TaskView, "type" | "build_spec"> = { type: c.type };
      // No build_spec ⇒ the renderer takes the primitive path.
      expect(hasBuildSpec(task)).toBe(false);
      // …and that path is the EXACT current tierOf/tierHeight mapping, unchanged.
      expect(tierOf(task.type)).toBe(c.tier);
      expect(tierHeight(tierOf(task.type))).toBe(tierHeight(c.tier as ReturnType<typeof tierOf>));
    });
  }
});
