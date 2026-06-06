# Model seam + one provider; bake one spec

> Type: HITL (needs a real API key + a look at generated output) · Build sequence step 3 ·
> [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md)

## What to build

The first real generation, off the critical path. Add the **Model seam** — one narrow Go
interface in `internal/harness/model` with `openai-go/v3` behind it, the provider selected by
config (`base_url` swap), GPT-class first. Add an offline **bake** step that, for **one** demo
Task, calls the model with the Task's Build contract + world snapshot, gets a structured Build
spec via strict `response_format json_schema`, runs **validate-and-repair** (re-ask once on
schema failure), and writes the approved spec to a cache keyed
`{blueprintId, taskId, contract-hash, model}`.

The headline then **replays the cached spec** through the slice 1–2 pipeline — fully
deterministic, no live call on the demo path. A cache miss falls back to the primitive.

The harness is reached only by the Rover (the shared package imported by `internal/agent`),
never by the browser; API keys stay server-side.

## Acceptance criteria

- [ ] `internal/harness/model` exposes a narrow `Model` interface; `openai-go/v3` adapter behind it; provider/base_url/model/key are config
- [ ] A contract test with a fake `Model` (no network) proves validate-and-repair and the fallback-on-exhaustion path
- [ ] A `bake` command generates one Task's Build spec via a GPT-class model and writes it to the cache (keyed as above)
- [ ] The headline replays the cached spec deterministically; a forced cache miss yields the primitive fallback, Task still DONE
- [ ] No API key reaches the browser
- [ ] A Go **import-graph architecture test** asserts `internal/harness/model` is not in the import closure of the hot-path packages (allocation/auction, lease/heartbeat, expiry, single-writer tick); it fails CI if a Model-seam call is wired into the hot loop (ADR-0005, promotes the TECHSPEC §8 grep)
- [ ] `go test -race ./...` green (live model calls are excluded from unit tests)

## Blocked by

- [02](./02-streamed-durable-resumable-ops.md)
