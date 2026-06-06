// buildspec — the pure Build-spec → mesh-descriptor mapping for Scene3D
// (TECHSPEC §4, ADR-0006). A Task's Build spec is an ordered list of declarative
// ops the renderer INTERPRETS into meshes; it is data, never executed code, so
// the scene stays a pure function of the snapshot (ADR-0004).
//
// Kept three-free / DOM-free (like lib/scene.ts) so it is unit-testable in
// vitest's node env: it converts each op into a plain descriptor, and Scene3D
// maps that onto either a primitive geometry + meshStandardMaterial OR — bh-07b —
// a glTF model (model_ref) / a textured material (material.map), loading the CC0
// asset and FALLING BACK to the primitive on any miss.
//
// The KEY invariant this file encodes is the FALLBACK: a Task with no (or an
// empty) build_spec yields no descriptors, so Scene3D renders exactly today's
// `tierOf` primitive — the visual regression guard the slice demands.

import type { BuildOp, BuildShape, TaskView } from "../types/wire";

// The primitive geometries the renderer builds today.
export type MeshGeometry = "box" | "cylinder" | "sphere";

// A renderer-ready description of one PRIMITIVE mesh, in the Task's Build-envelope
// frame. Plain numbers/strings only (no three types) so it round-trips through
// tests. `map` is an OPTIONAL texture URL (bh-07b, material.map): when present
// Scene3D loads it via TextureLoader and falls back to the flat color on failure.
export type PrimitiveDesc = {
  kind: "primitive";
  geometry: MeshGeometry;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler radians
  scale: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
  map?: string; // optional CC0 texture URL (bh-07b); undefined ⇒ flat color
};

// A renderer-ready description of one glTF MODEL placement (bh-07b, shape "model"
// + model_ref). Scene3D loads the .glb via GLTFLoader and places it with this
// transform; on a load failure it falls back to the `fallback` primitive so the
// scene never breaks.
export type ModelDesc = {
  kind: "model";
  modelRef: string; // CC0 glTF URL (e.g. /assets/models/hangar_roundA.glb)
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string; // tint / fallback-primitive color
  // The primitive to draw if the glTF fails to load (a box sized to the op),
  // keeping the scene a pure function of the snapshot even when an asset is gone.
  fallback: PrimitiveDesc;
};

// MeshDesc is either a primitive or a glTF model placement.
export type MeshDesc = PrimitiveDesc | ModelDesc;

// Procedural-material defaults when a Build op omits the optional PBR fields —
// matched to the task-block look so an interpreted mesh reads consistently with
// the primitive fallback.
export const DEFAULT_ROUGHNESS = 0.9;
export const DEFAULT_METALNESS = 0.05;

// renderableShapes maps a primitive shape to its geometry. "model" is handled
// separately (it produces a ModelDesc, not a primitive geometry).
const primitiveShapes: Record<Exclude<BuildShape, "model">, MeshGeometry> = {
  box: "box",
  cylinder: "cylinder",
  sphere: "sphere",
};

// commonTransform pulls the shared transform out of an op.
function transform(op: BuildOp): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
} {
  return {
    position: [op.pos.X, op.pos.Y, op.pos.Z],
    rotation: [op.rot.X, op.rot.Y, op.rot.Z],
    scale: [op.scale.X, op.scale.Y, op.scale.Z],
  };
}

// primitiveDesc builds a PrimitiveDesc from an op + a resolved geometry, carrying
// the optional texture map (bh-07b) when the op's material declares one.
function primitiveDesc(op: BuildOp, geometry: MeshGeometry): PrimitiveDesc {
  const t = transform(op);
  return {
    kind: "primitive",
    geometry,
    ...t,
    color: op.material.color,
    roughness: op.material.roughness ?? DEFAULT_ROUGHNESS,
    metalness: op.material.metalness ?? DEFAULT_METALNESS,
    ...(op.material.map ? { map: op.material.map } : {}),
  };
}

// opToMesh converts a single Build op into a MeshDesc, or null when it cannot be
// rendered. Defensive: a malformed op (the server validates, but a stray frame
// must never crash the pure render) yields null.
//
//   - box/cylinder/sphere → a PrimitiveDesc (with an optional texture map).
//   - model + model_ref   → a ModelDesc (glTF), with a box primitive fallback.
//   - model WITHOUT a model_ref → null (nothing to load; the server rejects this).
export function opToMesh(op: BuildOp): MeshDesc | null {
  if (!op.pos || !op.rot || !op.scale || !op.material) return null;

  if (op.shape === "model") {
    if (!op.model_ref) return null; // no asset to load ⇒ not renderable
    const t = transform(op);
    return {
      kind: "model",
      modelRef: op.model_ref,
      ...t,
      color: op.material.color,
      // Fallback primitive: a box at the same transform, so a failed glTF load
      // still draws SOMETHING the right size (the scene stays snapshot-pure).
      fallback: primitiveDesc({ ...op, shape: "box" }, "box"),
    };
  }

  const geometry = primitiveShapes[op.shape];
  if (!geometry) return null;
  return primitiveDesc(op, geometry);
}

// fold applies the append-only patch log in order and returns the current
// geometry as the surviving `place` ops (bh-08a, ADR-0006). It MIRRORS the Go
// spec.Fold exactly and is a PURE function (no input mutation) so it is
// unit-testable in isolation:
//
//   - place:  introduces a piece keyed by id (a re-placed id overwrites it).
//   - move:   updates the pos/rot/scale of an existing id (last-write-wins).
//   - delete: removes an existing id.
//
// Survivors keep first-seen order, so a place-only log (today's cache + primitive
// stream, with OR without ids) folds to itself — pixel-identical replay. A
// move/delete targeting an unknown id is a defensive no-op (the server already
// rejects it; a stray frame must never crash the pure render). An empty id is an
// ANONYMOUS place that always survives and can't be targeted, matching Go.
export function fold(ops: readonly BuildOp[]): BuildOp[] {
  const order: string[] = [];
  const byId = new Map<string, BuildOp>();
  ops.forEach((op, i) => {
    switch (op.op) {
      case "place": {
        const key = op.id === "" || op.id == null ? `\u0000anon-${i}` : op.id;
        if (!byId.has(key)) order.push(key);
        byId.set(key, op);
        break;
      }
      case "move": {
        const cur = byId.get(op.id);
        if (cur) byId.set(op.id, { ...cur, pos: op.pos, rot: op.rot, scale: op.scale });
        break; // unknown id ⇒ defensive no-op
      }
      case "delete": {
        byId.delete(op.id);
        break; // unknown id ⇒ defensive no-op
      }
    }
  });
  const out: BuildOp[] = [];
  for (const key of order) {
    const op = byId.get(key);
    if (op) out.push(op);
  }
  return out;
}

// interpretBuildSpec FOLDS a Task's patch log into current geometry, then maps
// the surviving ops into renderable mesh descriptors (preserving fold order,
// dropping non-renderable survivors). A Task with no build_spec (or an empty one)
// yields an EMPTY list — the signal Scene3D uses to fall through to the
// deterministic `tierOf` primitive (fallback unchanged). A place-only spec folds
// to itself, so this is byte-identical to today for existing replay.
export function interpretBuildSpec(task: Pick<TaskView, "build_spec">): MeshDesc[] {
  const ops = task.build_spec;
  if (!ops || ops.length === 0) return [];
  const out: MeshDesc[] = [];
  for (const op of fold(ops)) {
    const mesh = opToMesh(op);
    if (mesh) out.push(mesh);
  }
  return out;
}

// hasBuildSpec reports whether a Task carries any RENDERABLE Build-spec geometry.
// Used by Scene3D to choose the interpreter path vs. the primitive fallback —
// false keeps today's exact output. A spec whose ONLY ops are unrenderable (e.g.
// a "model" op with no model_ref) yields false, so the Task falls back.
export function hasBuildSpec(task: Pick<TaskView, "build_spec">): boolean {
  return interpretBuildSpec(task).length > 0;
}
