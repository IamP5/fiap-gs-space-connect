// buildspec — the pure Build-spec → mesh-descriptor mapping for Scene3D
// (TECHSPEC §4, ADR-0006). A Task's Build spec is an ordered list of declarative
// ops the renderer INTERPRETS into meshes; it is data, never executed code, so
// the scene stays a pure function of the snapshot (ADR-0004).
//
// Kept three-free / DOM-free (like lib/scene.ts) so it is unit-testable in
// vitest's node env: it converts each op into a plain MeshDesc, and Scene3D maps
// that onto a primitive geometry + meshStandardMaterial. The KEY invariant this
// file encodes is the FALLBACK: a Task with no (or an empty) build_spec yields no
// descriptors, so Scene3D renders exactly today's `tierOf` primitive — the visual
// regression guard the slice's acceptance criteria demands.

import type { BuildOp, BuildShape, TaskView } from "../types/wire";

// The primitive geometries the renderer can build today. "model" is a reserved
// forward-compatible glTF slot (ADR-0004): it is intentionally NOT renderable, so
// interpretBuildSpec skips it rather than inventing geometry.
export type MeshGeometry = "box" | "cylinder" | "sphere";

// A renderer-ready description of one mesh, in the Task's Build-envelope frame.
// Plain numbers/strings only (no three types) so it round-trips through tests.
export type MeshDesc = {
  geometry: MeshGeometry;
  position: [number, number, number];
  rotation: [number, number, number]; // Euler radians
  scale: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
};

// Procedural-material defaults when a Build op omits the optional PBR fields —
// matched to the task-block look so an interpreted mesh reads consistently with
// the primitive fallback.
export const DEFAULT_ROUGHNESS = 0.9;
export const DEFAULT_METALNESS = 0.05;

// renderableShapes is the set of shapes that map to a primitive today. "model"
// is deliberately absent: it is a no-op until glTF support lands (a later slice).
const renderableShapes: Record<BuildShape, MeshGeometry | null> = {
  box: "box",
  cylinder: "cylinder",
  sphere: "sphere",
  model: null,
};

// opToMesh converts a single Build op into a MeshDesc, or null when the op is not
// renderable today (shape "model"). Defensive: a malformed op (the server
// validates, but a stray frame must never crash the pure render) yields null.
export function opToMesh(op: BuildOp): MeshDesc | null {
  const geometry = renderableShapes[op.shape];
  if (!geometry) return null;
  if (!op.pos || !op.rot || !op.scale || !op.material) return null;
  return {
    geometry,
    position: [op.pos.X, op.pos.Y, op.pos.Z],
    rotation: [op.rot.X, op.rot.Y, op.rot.Z],
    scale: [op.scale.X, op.scale.Y, op.scale.Z],
    color: op.material.color,
    roughness: op.material.roughness ?? DEFAULT_ROUGHNESS,
    metalness: op.material.metalness ?? DEFAULT_METALNESS,
  };
}

// interpretBuildSpec maps a Task's ordered Build spec into renderable mesh
// descriptors, preserving op order and dropping non-renderable ops. A Task with
// no build_spec (or an empty one) yields an EMPTY list — the signal Scene3D uses
// to fall through to the deterministic `tierOf` primitive (fallback unchanged).
export function interpretBuildSpec(task: Pick<TaskView, "build_spec">): MeshDesc[] {
  const ops = task.build_spec;
  if (!ops || ops.length === 0) return [];
  const out: MeshDesc[] = [];
  for (const op of ops) {
    const mesh = opToMesh(op);
    if (mesh) out.push(mesh);
  }
  return out;
}

// hasBuildSpec reports whether a Task carries any RENDERABLE Build-spec geometry.
// Used by Scene3D to choose the interpreter path vs. the primitive fallback —
// false (including a spec of only future "model" ops) keeps today's exact output.
export function hasBuildSpec(task: Pick<TaskView, "build_spec">): boolean {
  return interpretBuildSpec(task).length > 0;
}
