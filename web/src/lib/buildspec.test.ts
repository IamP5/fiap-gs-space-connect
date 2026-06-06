// buildspec.test.ts — the Build-spec → mesh mapping is pure data (no three, no
// DOM), so it runs in vitest's node env, mirroring scene.test.ts's pure-math
// style. The load-bearing case for slice bh-01 is the FALLBACK: a Task with no
// build_spec must yield NO interpreted meshes, so Scene3D renders exactly today's
// `tierOf` primitive — proving the renderer fallback is invisible.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_METALNESS,
  DEFAULT_ROUGHNESS,
  fold,
  hasBuildSpec,
  interpretBuildSpec,
  opToMesh,
} from "./buildspec";
import { tierHeight, tierOf } from "./scene";
import type { BuildOp, TaskView } from "../types/wire";

const v3 = (X: number, Y: number, Z: number) => ({ X, Y, Z });

const box: BuildOp = {
  op: "place",
  id: "box-1",
  shape: "box",
  pos: v3(1, 2, 3),
  rot: v3(0, Math.PI, 0),
  scale: v3(2, 0.5, 2),
  material: { color: "#cfcfd6", roughness: 0.8, metalness: 0.1 },
};

// placeAt is a well-formed place op with a stable id at the given position.
const placeAt = (id: string, X: number, Y: number, Z: number): BuildOp => ({
  ...box,
  id,
  pos: v3(X, Y, Z),
});

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

// fold is the bh-08a patch-log reducer. These cases mirror the Go spec.Fold
// tests so the two renderers fold IDENTICALLY.
describe("fold", () => {
  // ACCEPTANCE (a): place 3 / move 1 / delete 1 → correct final 2 pieces.
  it("folds place 3 / move 1 / delete 1 into the correct survivors + positions", () => {
    const ops: BuildOp[] = [
      placeAt("a", 0, 0, 0),
      placeAt("b", 1, 0, 0),
      placeAt("c", 2, 0, 0),
      { op: "move", id: "b", shape: "box", pos: v3(1, 5, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
      { op: "delete", id: "a", shape: "box", pos: v3(0, 0, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
    ];
    const out = fold(ops);
    expect(out.map((o) => o.id)).toEqual(["b", "c"]); // a deleted, first-seen order kept
    expect(out[0].pos).toEqual(v3(1, 5, 0)); // b moved
    expect(out[1].pos).toEqual(v3(2, 0, 0)); // c untouched
    // move must not clobber the place's shape/material.
    expect(out[0].shape).toBe("box");
    expect(out[0].material.color).toBe("#cfcfd6");
  });

  // ACCEPTANCE (b): a place-only spec folds to itself (regression guard).
  it("folds a place-only spec to itself (pixel-identical replay guard)", () => {
    const ops: BuildOp[] = [placeAt("a", 0, 0, 0), placeAt("b", 1, 0, 0), placeAt("c", 0, 1, 0)];
    expect(fold(ops)).toEqual(ops);
  });

  // Legacy cache specs omit ids (anonymous places) — they must still fold to themselves.
  it("folds an id-less (legacy cache) place-only spec to itself", () => {
    const ops: BuildOp[] = [
      { ...box, id: "" },
      { ...box, id: "", pos: v3(9, 9, 9) },
    ];
    expect(fold(ops)).toEqual(ops);
  });

  it("applies last-write-wins for a re-placed id, keeping its original slot", () => {
    const out = fold([placeAt("a", 0, 0, 0), placeAt("b", 1, 0, 0), placeAt("a", 9, 9, 9)]);
    expect(out.map((o) => o.id)).toEqual(["a", "b"]);
    expect(out[0].pos).toEqual(v3(9, 9, 9));
  });

  it("treats a move/delete of an unknown id as a defensive no-op", () => {
    const ops: BuildOp[] = [
      placeAt("a", 0, 0, 0),
      { op: "move", id: "ghost", shape: "box", pos: v3(5, 5, 5), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
      { op: "delete", id: "ghost", shape: "box", pos: v3(0, 0, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
    ];
    expect(fold(ops)).toEqual([placeAt("a", 0, 0, 0)]); // unchanged
  });

  it("does not mutate its input", () => {
    const ops: BuildOp[] = [
      placeAt("a", 0, 0, 0),
      { op: "move", id: "a", shape: "box", pos: v3(7, 0, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
    ];
    const snapshot = structuredClone(ops);
    fold(ops);
    expect(ops).toEqual(snapshot);
  });
});

describe("interpretBuildSpec", () => {
  it("preserves op order across primitives and models", () => {
    const spec: BuildOp[] = [
      { ...box, id: "1", shape: "box" },
      { ...box, id: "2", shape: "model", model_ref: "/x.glb" },
      { ...box, id: "3", shape: "sphere" },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes.map((m) => m.kind)).toEqual(["primitive", "model", "primitive"]);
  });

  it("drops a non-renderable op (a 'model' with no model_ref) but keeps the rest", () => {
    const spec: BuildOp[] = [
      { ...box, id: "1", shape: "box" },
      { ...box, id: "2", shape: "model" }, // dropped (no model_ref)
      { ...box, id: "3", shape: "sphere" },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes.map((m) => m.kind)).toEqual(["primitive", "primitive"]);
  });

  // bh-08a: interpretBuildSpec consumes the FOLDED result — place 3, move 1,
  // delete 1 renders the correct 2 meshes at the folded positions.
  it("renders the folded geometry (place 3 / move 1 / delete 1 → 2 meshes)", () => {
    const spec: BuildOp[] = [
      placeAt("a", 0, 0, 0),
      placeAt("b", 1, 0, 0),
      placeAt("c", 2, 0, 0),
      { op: "move", id: "b", shape: "box", pos: v3(1, 5, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
      { op: "delete", id: "a", shape: "box", pos: v3(0, 0, 0), rot: v3(0, 0, 0), scale: v3(1, 1, 1), material: { color: "#000" } },
    ];
    const meshes = interpretBuildSpec({ build_spec: spec });
    expect(meshes).toHaveLength(2);
    expect(meshes[0].position).toEqual([1, 5, 0]); // b moved
    expect(meshes[1].position).toEqual([2, 0, 0]); // c untouched
  });

  // REGRESSION GUARD: a place-only spec renders identically whether or not the
  // fold pass exists — folded interpretation equals mapping the raw ops directly.
  it("renders a place-only spec identically to mapping the raw ops (no regression)", () => {
    const spec: BuildOp[] = [
      placeAt("a", 0, 0, 0),
      { ...box, id: "b", shape: "sphere" },
      placeAt("c", 2, 0, 0),
    ];
    const folded = interpretBuildSpec({ build_spec: spec });
    const direct = spec.map(opToMesh).filter((m): m is NonNullable<typeof m> => m !== null);
    expect(folded).toEqual(direct);
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
