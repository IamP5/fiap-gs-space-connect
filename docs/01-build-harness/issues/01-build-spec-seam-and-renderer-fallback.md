# Build-spec seam + renderer interpreter + fallback

> Type: AFK · Build sequence step 1 · [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md),
> [ADR-0004](../../00-mvp/adr/0004-react-three-fiber-3d-built-2d-first.md)

## What to build

The thinnest complete path for geometry-as-data, with **no LLM involved**. Add an optional
**Build spec** field to the wire snapshot's Task view (Go `internal/wire` + the TypeScript
mirror), carrying an ordered list of declarative build ops. Teach the renderer
(`Scene3D`) to **interpret** a Task's Build spec into meshes; when the field is absent, it
renders **exactly today's `tierOf` primitive** — so the fallback is provably invisible.

Drive it from a hardcoded sample Build spec on one demo Task to prove the whole seam
end-to-end. The Build spec is just more durable Task state; the scene stays a pure function
of the snapshot. The schema is forward-compatible (a `shape` of `box|cylinder|sphere|model`,
transform, material with optional texture `map`, optional `model_ref`) even though only
primitives + procedural materials are rendered now.

The spec ops are **validated against a JSON schema** server-side before they reach the
snapshot (reject malformed); the validator is reused by later slices.

## Acceptance criteria

- [ ] `TaskView` carries an optional `build_spec` (ordered build ops) in the Go wire contract and the TS mirror; they round-trip
- [ ] A Build-spec JSON schema exists; malformed specs are rejected server-side with a unit test
- [ ] `Scene3D` interprets a Task's Build spec into meshes (box/cylinder/sphere + procedural material)
- [ ] With `build_spec` absent, the rendered scene is pixel-identical to the current `tierOf` output (web unit test asserts the mapping is unchanged)
- [ ] A hardcoded sample spec on one demo Task renders a richer structure than the primitive, live over the WebSocket
- [ ] No change to Allocation, Lease, World, or Planner; `go test -race ./...` and `(cd web && npm run build && npm test)` green

## Blocked by

None — can start immediately.
