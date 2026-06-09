
import type { BuildOp, BuildShape, TaskView } from "../types/wire";

export type MeshGeometry = "box" | "cylinder" | "sphere";

export type PrimitiveDesc = {
  kind: "primitive";
  geometry: MeshGeometry;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  roughness: number;
  metalness: number;
  map?: string;
  normalMap?: string;
  roughnessMap?: string;
  aoMap?: string;
};

export type ModelDesc = {
  kind: "model";
  modelRef: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  fallback: PrimitiveDesc;
};

export type MeshDesc = PrimitiveDesc | ModelDesc;

export const DEFAULT_ROUGHNESS = 0.9;
export const DEFAULT_METALNESS = 0.05;

const primitiveShapes: Record<Exclude<BuildShape, "model" | "module">, MeshGeometry> = {
  box: "box",
  cylinder: "cylinder",
  sphere: "sphere",
};

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
    ...(op.material.normal_map ? { normalMap: op.material.normal_map } : {}),
    ...(op.material.roughness_map ? { roughnessMap: op.material.roughness_map } : {}),
    ...(op.material.ao_map ? { aoMap: op.material.ao_map } : {}),
  };
}

export function opToMesh(op: BuildOp): MeshDesc | null {
  if (!op.pos || !op.rot || !op.scale || !op.material) return null;

  if (op.shape === "model") {
    if (!op.model_ref) return null;
    const t = transform(op);
    return {
      kind: "model",
      modelRef: op.model_ref,
      ...t,
      color: op.material.color,
      fallback: primitiveDesc({ ...op, shape: "box" }, "box"),
    };
  }

  if (op.shape === "module") return null;
  const geometry = primitiveShapes[op.shape];
  if (!geometry) return null;
  return primitiveDesc(op, geometry);
}

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
        break;
      }
      case "delete": {
        byId.delete(op.id);
        break;
      }
    }
  });
  const out: BuildOp[] = [];
  const emitted = new Set<string>();
  for (const key of order) {
    if (emitted.has(key)) continue;
    const op = byId.get(key);
    if (op) {
      out.push(op);
      emitted.add(key);
    }
  }
  return out;
}

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

export type ModuleSpec = { kind: string; shown: number };

export function interpretModuleSpec(task: Pick<TaskView, "build_spec">): ModuleSpec | null {
  const ops = task.build_spec;
  if (!ops || ops.length === 0) return null;
  const modules = fold(ops).filter((o) => o.shape === "module");
  if (modules.length === 0) return null;
  return { kind: modules[0].part ?? "", shown: modules.length };
}

export function hasBuildSpec(task: Pick<TaskView, "build_spec">): boolean {
  return interpretBuildSpec(task).length > 0;
}
