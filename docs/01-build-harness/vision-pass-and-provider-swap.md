# Bake-time vision pass + provider swap (bh-06)

> Operator note for [issue 06](./issues/06-vision-evaluator-and-provider-swap.md),
> [TECHSPEC §5](./TECHSPEC.md), [ADR-0008](./adr/0008-lab-loop-observability-and-layered-evaluator.md).
> Everything here is **bake/lab only** — the headline replays frozen specs and makes
> ZERO vision/model calls (enforced by `internal/harness/archtest`).

## What the vision pass does

The analytic Evaluator hard gate catches geometry that is out-of-envelope, colliding,
or under-built. It cannot catch a spec that is geometrically valid but **looks wrong**
on stage. The bake-time vision pass closes that loop:

1. For each hard-gate-passing candidate spec, `internal/harness/vision` renders the
   **real `Scene3D`** in headless Chrome (a standalone Vite entry, `web/bake-harness.html`,
   that mounts `Scene3D` with the spec injected as a single DONE task at a fixed camera
   framing — no animation, no randomness, so the screenshot is reproducible).
2. It screenshots the WebGL canvas to PNG.
3. It feeds the PNG to a **vision-capable** model (gpt-4o) through the Model seam and
   scores the `silhouette` soft-rubric dimension **0–2 + evidence**.
4. The score + evidence land in the **trace sidecar** and the evaluator rubric. Within
   the bounded refine budget a low silhouette triggers another Generator iteration; on
   exhaustion the spec **still caches**, flagged `quality_flag: low` — never withheld
   (ADR-0008). A vision failure (no Chrome, bad key, beta compat rejects) is non-fatal:
   the dimension stays unscored and the analytic verdict stands.

The vision pass reaches the Model seam **and** drives a headless browser, so — like the
generation loop — it is kept strictly off the hot path. `archtest` names
`internal/harness/vision` in its lab-only set and adds
`TestHeadlinePathMakesZeroVisionCalls` (the cache + every hot-path package must NOT import
the vision pass).

## Running the live vision pass

Prerequisites: a vision-capable model (gpt-4o), headless Chrome, and the built web bundle.

```sh
# 1. Build the web bundle (produces web/dist/bake-harness.html + assets).
cd web && npm run build && cd ..

# 2. Load the key (never commit .env — it is gitignored).
set -a; . ./.env; set +a            # exports OPENAI_API_KEY and GEMINI_API_KEY

# 3. Bake ONE task with the vision pass on (headless Chrome screenshots the real Scene3D).
go run ./cmd/bake -task dome-cap -type dome-cap -model gpt-4o -vision

# 4. Or bake the WHOLE dome with vision scoring + operator review.
go run ./cmd/bake -all -model gpt-4o -vision
```

Flags added in bh-06:

| flag         | meaning                                                                 |
|--------------|-------------------------------------------------------------------------|
| `-vision`    | enable the bake-time vision pass (needs the web bundle + Chrome)         |
| `-web-dist`  | built web bundle dir (default `<repo>/web/dist`)                         |
| `-chrome`    | headless Chrome binary path (default `$CHROME_PATH`, then the macOS app) |

On macOS there is no `google-chrome` on `PATH`; the driver defaults to
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. `-vision` fails LOUDLY if
the bundle or Chrome is missing — it never silently degrades to a no-op.

## Provider swap (OpenAI ↔ Gemini) — config only, NO harness code change

The Model seam is one OpenAI-compatible adapter; the provider is purely a `base_url` +
key swap (TECHSPEC §4). The SAME bake binary drives both:

```sh
# OpenAI (default).
go run ./cmd/bake -all -provider openai -model gpt-4o-2024-08-06

# Gemini via its OpenAI-compatible endpoint — base_url resolves automatically from the
# provider label; the key comes from GEMINI_API_KEY. No code change.
go run ./cmd/bake -all -provider gemini -model gemini-2.0-flash
```

`cmd/bake` maps the provider label to its base URL (`internal/harness/model`):

- OpenAI → `https://api.openai.com/v1` (key: `OPENAI_API_KEY`)
- Gemini → `https://generativelanguage.googleapis.com/v1beta/openai/` (key: `GEMINI_API_KEY`)
- local  → `http://localhost:11434/v1` (Ollama; no real key)

The provider/model is part of the cache key, so a Gemini bake writes distinct
`dome_*_<gemini-model>.json` files and never silently overwrites the OpenAI specs.

### Structured-output gotchas

Gemini's OpenAI-compatibility layer is officially **beta**, so the **validate-and-repair
pass is retained** for both providers: the strict `response_format` json_schema is sent,
the output is parsed and run through `spec.Validate` (the authoritative server-side gate),
and on a failure the seam re-asks ONCE with the exact validation error appended before
falling back to the primitive. Strict-mode discipline (object root, every property in
`required`, `additionalProperties:false`, optionals expressed as nullable-required) is the
same for both adapters — it is the bh-03 finding and it is what lets one schema drive both
vendors.

Observed during the bh-06 live runs (filled in from the actual swap):

<!-- LIVE-RESULTS:START -->
- **OpenAI bake (gpt-4o-2024-08-06) + vision pass — `dome-cap`:** strict json_schema
  held; the loop ran two iterations driven by the silhouette score:
  - iter 0 → silhouette **0**: _"The structure appears as a small, flat white dot
    against a dark background, lacking..."_ → triggered another Generator iteration;
  - iter 1 → silhouette **2**: _"The structure's silhouette forms a clear dome shape
    with a slightly elevated cap..."_ → soft score 6/6, cached `quality_flag: ok`.
  This is the bh-06 lever end-to-end: a structure that passed the analytic hard gate
  but "looked wrong" was caught by the vision pass and refined. The committed
  `dome_dome-cap_*.trace.json` carries both scores + evidence.
- **Gemini bake (OpenAI-compat, `gemini-2.5-flash`) — config-only swap — `foundation-1`:**
  by `-provider gemini` (base_url + `GEMINI_API_KEY`) only, NO harness code change, the
  SAME bake binary produced **7 valid ops** that passed `spec.Validate` and the hard gate,
  cached `quality_flag: ok`. **Strict json_schema HELD on the first attempt** —
  `repaired: false`, one iteration, no validation re-ask. The object-rooted strict schema
  with nullable-required optionals (`type: ["number","null"]`) round-tripped through the
  beta compat layer without a field-shape difference. (Proof only — the artifact was NOT
  committed: a `gemini-*` filename sorts before `gpt-4o-*` and would win the deterministic
  replay tie, silently swapping the demo's foundation-1 geometry.)
- **Gotchas observed:**
  - `gemini-2.0-flash` and `gemini-2.5-flash` are the working ids via the compat endpoint;
    `gemini-1.5-flash` / `gemini-1.5-flash-8b` returned **404 Not Found** (not exposed on
    the v1beta OpenAI-compat surface).
  - Free-tier Gemini quota is tight: repeated bakes hit **429 Too Many Requests**, which the
    validate-and-repair pass treats as a transport error → immediate primitive fallback
    (the core never blocks). Space out runs or use a paid key for `-all`.
  - The validate-and-repair pass is retained for BOTH providers precisely because the
    compat layer is beta; in these runs no repair re-ask was needed, but the guard stays.
<!-- LIVE-RESULTS:END -->
