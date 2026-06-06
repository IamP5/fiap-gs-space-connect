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

Separately, **prove the Model seam's promise**: run the same bake against a **second vendor**
(Gemini via its OpenAI-compatible endpoint) by config change only — no harness code change —
and confirm structured output still validates (Gemini's compat layer is officially beta, so
keep the validate-and-repair pass).

## Acceptance criteria

- [ ] A bake-time vision pass renders a candidate spec via headless Chrome on the real `Scene3D`, screenshots it, and scores it with a vision model
- [ ] Specs that pass the analytic gate but fail the vision score are sent back for refinement before caching
- [ ] The vision pass runs only in bake/lab; the headline path makes zero vision calls
- [ ] The same bake runs against Gemini (OpenAI-compat) by config only; specs still validate (validate-and-repair retained)
- [ ] A short doc note records the swap procedure and any structured-output gotchas observed

## Blocked by

- [04](./04-generator-evaluator-loop-and-bake-all.md)
