# Vision evaluator pass + provider-swap proof

> Type: HITL (visual-quality judgment + a second vendor key) · Build sequence step 6 ·
> [TECHSPEC](../TECHSPEC.md) · respects
> [ADR-0006](../adr/0006-build-spec-is-declarative-data-not-executed-code.md)

## What to build

Close the loop the analytic gate can't: structures that are geometrically valid but **look
wrong**. At **bake time only**, add a vision pass to the Evaluator — render a candidate Build
spec by driving **headless Chrome against the real `Scene3D`** with the spec injected,
screenshot it, and feed the image to a **vision-capable** model that scores it against the
contract before the spec is frozen to cache. This is the Anthropic "evaluator looks at the
running artifact" lever; it never runs on the headline path.

The vision score populates the **`silhouette` dimension of the Evaluator's soft rubric**
([ADR-0008](../adr/0008-lab-loop-observability-and-layered-evaluator.md)): within the bounded
refine budget a low silhouette triggers another iteration, but — like the rest of the soft
rubric — it **never blocks caching**. A spec that exhausts the budget still caches, flagged
`quality_flag: low`, and the score + evidence land in the trace.

Separately, **prove the Model seam's promise**: run the same bake against a **second vendor**
(Gemini via its OpenAI-compatible endpoint) by config change only — no harness code change —
and confirm structured output still validates (Gemini's compat layer is officially beta, so
keep the validate-and-repair pass).

## Acceptance criteria

- [ ] A bake-time vision pass renders a candidate spec via headless Chrome on the real `Scene3D`, screenshots it, and scores it with a vision model
- [ ] The vision score populates the `silhouette` soft-rubric dimension (0–2 + evidence) and lands in the trace; within the refine budget a low score triggers another iteration, but on exhaustion the spec still caches flagged `quality_flag: low` (never withheld — ADR-0008)
- [ ] The vision pass runs only in bake/lab; the headline path makes zero vision calls
- [ ] The same bake runs against Gemini (OpenAI-compat) by config only; specs still validate (validate-and-repair retained)
- [ ] A short doc note records the swap procedure and any structured-output gotchas observed

## Blocked by

- [04](./04-generator-evaluator-loop-and-bake-all.md)
