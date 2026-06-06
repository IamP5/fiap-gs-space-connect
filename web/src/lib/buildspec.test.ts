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
  it("maps a box op to a primitive descriptor with its transform + material", () => {
    const m = opToMesh(box);
    if (!m || m.kind !== "primitive") throw new Error("expected a primitive descriptor");
    expect(m.geometry).toBe("box");
    expect(m.position).toEqual([1, 2, 3]);
    expect(m.rotation).toEqual([0, Math.PI, 0]);
    expect(m.scale).toEqual([2, 0.5, 2]);
    expect(m.color).toBe("#cfcfd6");
    expect(m.roughness).toBe(0.8);
    expect(m.metalness).toBe(0.1);
    expect(m.map).toBeUndefined(); // no texture unless material.map is set
  });

  it("maps cylinder and sphere shapes to their geometries", () => {
    const c = opToMesh({ ...box, shape: "cylinder" });
    const s = opToMesh({ ...box, shape: "sphere" });
    if (!c || c.kind !== "primitive") throw new Error("expected primitive");
    if (!s || s.kind !== "primitive") throw new Error("expected primitive");
    expect(c.geometry).toBe("cylinder");
    expect(s.geometry).toBe("sphere");
  });

  it("defaults the optional PBR fields when omitted", () => {
    const m = opToMesh({ ...box, material: { color: "#fff" } });
    if (!m || m.kind !== "primitive") throw new Error("expected primitive");
    expect(m.roughness).toBe(DEFAULT_ROUGHNESS);
    expect(m.metalness).toBe(DEFAULT_METALNESS);
  });

  // bh-07b: material.map carries a texture onto the primitive descriptor.
  it("carries a texture map onto the primitive descriptor when present", () => {
    const m = opToMesh({
      ...box,
      material: { color: "#cfcfd6", map: "/assets/textures/rock.jpg" },
    });
    if (!m || m.kind !== "primitive") throw new Error("expected primitive");
    expect(m.map).toBe("/assets/textures/rock.jpg");
  });

  // bh-07b: a "model" op with a model_ref produces a glTF descriptor that names
  // the asset to load AND a box primitive fallback (so a failed load still draws).
  it("maps a 'model' op + model_ref to a glTF descriptor with a primitive fallback", () => {
    const m = opToMesh({ ...box, shape: "model", model_ref: "/assets/models/h.glb" });
    if (!m || m.kind !== "model") throw new Error("expected a model descriptor");
    expect(m.modelRef).toBe("/assets/models/h.glb");
    expect(m.position).toEqual([1, 2, 3]);
    expect(m.scale).toEqual([2, 0.5, 2]);
    // The fallback is a same-transform box primitive (never a model).
    expect(m.fallback.kind).toBe("primitive");
    expect(m.fallback.geometry).toBe("box");
    expect(m.fallback.position).toEqual([1, 2, 3]);
  });

  it("returns null for a 'model' op WITHOUT a model_ref (nothing to load)", () => {
    expect(opToMesh({ ...box, shape: "model" })).toBeNull();
  });
});

describe("interpretBuildSpec", () => {
  it("preserves op order across primitives and models", () => {
    const spec: BuildOp[] = [
      { ...box, shape: "box" },
      { ...box, shape: "model", model_ref: "/x.glb" },
      { ...box, shape: "sphere" },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes.map((m) => m.kind)).toEqual(["primitive", "model", "primitive"]);
  });

  it("drops a non-renderable op (a 'model' with no model_ref) but keeps the rest", () => {
    const spec: BuildOp[] = [
      { ...box, shape: "box" },
      { ...box, shape: "model" }, // dropped (no model_ref)
      { ...box, shape: "sphere" },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes.map((m) => m.kind)).toEqual(["primitive", "primitive"]);
  });

  it("yields an empty list when build_spec is absent (fallback signal)", () => {
    expect(interpretBuildSpec({})).toEqual([]);
    expect(interpretBuildSpec({ build_spec: undefined })).toEqual([]);
    expect(interpretBuildSpec({ build_spec: [] })).toEqual([]);
  });
});

describe("hasBuildSpec", () => {
  it("is true when the Task has renderable Build-spec geometry", () => {
    expect(hasBuildSpec({ build_spec: [box] })).toBe(true);
    // bh-07b: a "model" op WITH a model_ref now renders (the slot is implemented).
    expect(hasBuildSpec({ build_spec: [{ ...box, shape: "model", model_ref: "/x.glb" }] })).toBe(
      true,
    );
  });

  it("is false with no spec, or a spec of only unrenderable ops (fallback)", () => {
    expect(hasBuildSpec({})).toBe(false);
    expect(hasBuildSpec({ build_spec: [] })).toBe(false);
    // A "model" op with NO model_ref has nothing to load ⇒ not renderable ⇒ fall back.
    expect(hasBuildSpec({ build_spec: [{ ...box, shape: "model" }] })).toBe(false);
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
