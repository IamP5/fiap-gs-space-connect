# Plan — agents build the immersive structures block-by-block (`module` build-op)

## Problem

Milestone 08 added the immersive procedural buildings (`web/src/components/Structures.tsx`,
`StructurePiece`) and wired them into the **preview** (`BlueprintGhost`) and the
**no-build_spec fallback** in `Scene3D.tsx`'s `TaskBlock`. But the **live k8s path**
(real rovers over NATS) streams a `build_spec` of primitive `box/cylinder/sphere` ops
from `internal/agent/opsource.go`; in `TaskBlock` any non-empty `build_spec` takes the
`interpreted` branch (`SpecMesh`) and renders the **old grey primitives**, never reaching
`StructurePiece`. The mocks (`npm run dev`) omit `build_spec`, which is why dev looked new
but k8s built old blocks.

The immersive look depends on emissive meshes, point lights, torus, truncated spheres and
tapered cylinders — **none** expressible through the primitive-op contract — so we cannot
reproduce it with `box/cylinder/sphere` ops. Instead we make the immersive structures the
build_spec contract.

## Path confirmed

k8s rovers run `cmd/agent --mode=container` with no `--blueprint`, so `cfg.BlueprintID == ""`
→ `opsFor` skips the replay cache and uses `buildOpsFor(t)`. The LLM/replay-cache path is
**not** in the k8s path and is out of scope (per decision: normal generation only).

## Design — a `module` build-op + reveal-by-count

Add a new build-op shape **`module`** carrying a **`part`** key (the `StructureKind`:
`foundation|wall|dome|panel|mast|dish`). A rover streams **N** module ops per task — one per
build step — and the renderer reveals the first *k* steps of the real `StructurePiece` as the
*k*-th op folds in. Op-by-op rising and the kill→re-auction→finish self-heal are preserved by
the existing `Seq`-dedupe + fold mechanism (module ops are deterministic by index, so two
rovers converge byte-for-byte).

`part`-count per kind (backend N == frontend step count; cross-checked by tests):
`foundation 7, wall 7, dome 8, panel 5, mast 5, dish 3`.

### Backend
- `internal/wire/wire.go`: `ShapeModule BuildShape = "module"`; add `Part string \`json:"part,omitempty"\`` to `BuildOp`.
- `internal/harness/spec/spec.go` + `schema.json`: accept `module` (requires non-empty `part`,
  no `model_ref`; non-module ops must have empty `part`).
- `internal/agent/opsource.go`: `buildOpsFor(id, type)` → `structureKind(type,id)` (mirrors
  frontend `kindOf`) → emit `partCount[kind]` module ops. Remove the primitive generators.
- `internal/agent/agent.go`: thread task id into `buildOpsFor` (caller `opsFor` already has it).

### Frontend
- `web/src/types/wire.ts`: add `"module"` to `BuildShape`; add `part?: string` to `BuildOp`.
- `web/src/lib/buildspec.ts`: `interpretModuleSpec(task)` → `{ kind, shown } | null`
  (folds, counts module ops). `opToMesh` already drops `module` (unknown primitive) → the
  primitive interpreter naturally ignores them.
- `web/src/components/Scene3D.tsx` `TaskBlock`: if a module spec is present, render
  `StructurePiece` with `reveal = shown`; a LEASED task with no ops yet → `reveal = 0`;
  built/ghost with no spec → `reveal = undefined` (full). The primitive/glTF `interpreted`
  branch is unchanged (kept for asset_key/model specs).
- `web/src/components/Structures.tsx`: each kind component gains `reveal?: number`, builds an
  ordered `steps[]` and renders `steps.slice(0, reveal ?? steps.length)`; `reveal === 0`
  renders the footprint/null (same as `ghost`). `StructurePiece` threads `reveal` through.

## Verify
- `go build ./... && go test ./...` (esp. coordinator buildops/replay/liveresume convergence).
- `cd web && npm run build` (typecheck) + vitest.
- k8s: `deploy/k8s/up.sh`, drag-place a structure, confirm rovers raise the immersive
  building block-by-block and that killing a rover mid-build still completes it.
