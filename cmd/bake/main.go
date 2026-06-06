// Command bake is the SwarmBuild offline generation step (TECHSPEC §3/§4,
// ADR-0007/0008): it runs the Generator↔Evaluator refine loop for demo Task(s) via
// a GPT-class model and writes the approved Build spec(s) + per-Task trace sidecars
// to the committed cache, so the headline replays them deterministically with no
// live model call. It is the ONLY binary that reaches the Model seam.
//
// Usage:
//
//	set -a; . ./.env; set +a            # load OPENAI_API_KEY (never commit .env)
//	go run ./cmd/bake -task foundation-1 -type foundation   # bake ONE task
//	go run ./cmd/bake -all                                   # bake the WHOLE dome
//
// -all bakes every demo Blueprint Task in dependency order (foundations → walls →
// dome-cap), writing a spec + trace per Task and printing the operator review
// (which Tasks fell back ∪ which were cached quality_flag:low). The API key is read
// from the environment ONLY and never logged or shipped near the browser. On model
// exhaustion a Task falls back to the primitive (the dome still completes); a hard
// generation/IO error exits non-zero.
package main

import (
	"bufio"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/demo"
	"swarmbuild/internal/harness/bake"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/loop"
	"swarmbuild/internal/harness/model"
	"swarmbuild/internal/harness/vision"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))
	if err := run(); err != nil {
		slog.Error("bake failed", "error", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		taskID   = flag.String("task", "foundation-1", "demo task id to bake (e.g. foundation-1, wall-1, dome-cap)")
		taskType = flag.String("type", "foundation", "task type: foundation | wall | dome-cap")
		provider = flag.String("provider", "openai", "provider label: openai | gemini | local")
		baseURL  = flag.String("base-url", "", "provider base_url override (empty ⇒ provider default)")
		modelID  = flag.String("model", "gpt-4o-2024-08-06", "model id (GPT-class)")
		outDir   = flag.String("out", "", "cache output dir (empty ⇒ committed internal/harness/cache/specs)")
		envFile  = flag.String("env", ".env", "optional .env file to load for the key (never committed)")
		timeout  = flag.Duration("timeout", 60*time.Second, "overall generation timeout (per bake run)")
		all      = flag.Bool("all", false, "bake EVERY demo Blueprint Task in dependency order (the whole dome) + emit the operator review")
		visionOn = flag.Bool("vision", false, "run the bake-time VISION PASS: render each spec on the real Scene3D headless, screenshot it, and score silhouette (needs a built web bundle + headless Chrome; bh-06)")
		webDist  = flag.String("web-dist", "", "built web bundle dir for the vision render harness (empty ⇒ <repo>/web/dist); only used with -vision")
		chrome   = flag.String("chrome", "", "headless Chrome binary path for the vision pass (empty ⇒ $CHROME_PATH then the macOS default)")
	)
	flag.Parse()

	// Best-effort: load the .env so OPENAI_API_KEY is available even when the caller
	// forgot `set -a; . ./.env`. A missing .env is fine (the key may already be in
	// the environment); a present one never overrides an already-set variable.
	loadDotEnv(*envFile)

	baseURLResolved := resolveBaseURL(*provider, *baseURL)
	apiKey := apiKeyFor(*provider)
	if apiKey == "" {
		return fmt.Errorf("no API key in environment for provider %q (set %s); .env is gitignored, load it first", *provider, apiKeyEnv(*provider))
	}

	m, err := model.NewOpenAI(model.Config{
		Provider: *provider,
		BaseURL:  baseURLResolved,
		Model:    *modelID,
		APIKey:   apiKey,
	})
	if err != nil {
		return err
	}

	root, rErr := repoRoot()
	if rErr != nil {
		return rErr
	}
	dir := *outDir
	if dir == "" {
		dir = cache.DefaultStoreDir(root)
	}
	store, err := cache.NewStore(dir)
	if err != nil {
		return err
	}

	// Optional bake-time vision pass (bh-06): render each spec on the real Scene3D
	// headless and score silhouette. Built only when -vision is set; nil ⇒
	// analytic-only bake (the headline never reaches here either way).
	visionScorer, vErr := buildVisionScorer(*visionOn, m, root, *webDist, *chrome)
	if vErr != nil {
		return vErr
	}

	if *all {
		return bakeAll(m, store, dir, *provider, *modelID, baseURLResolved, *timeout, visionScorer)
	}

	contract, err := bake.DemoContract(domain.TaskID(*taskID), domain.TaskType(*taskType))
	if err != nil {
		return err
	}
	world := bake.WorldContext{Note: "demo dome on the lunar surface; build in the Task envelope frame"}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	// The single-task vision scorer carries this task's own contract description so
	// the silhouette is judged against the right intent.
	if ls, ok := visionScorer.(vision.LoopScorer); ok {
		ls.Description = contract.Done.Description
		ls.Style = contract.Style
		visionScorer = ls
	}

	slog.Info("baking", "provider", *provider, "model", *modelID, "task", *taskID, "type", *taskType, "base_url", baseURLResolved, "vision", visionScorer != nil)
	res, err := bake.Bake(ctx, m, store, contract, world, *provider, *modelID, visionScorer)
	if err != nil {
		if errors.Is(err, model.ErrFallback) {
			return fmt.Errorf("generation exhausted (validate-and-repair gave up): %w — demo will use the primitive fallback; nothing cached", err)
		}
		return err
	}

	slog.Info("baked", "ops", res.Ops, "key", res.Key.Filename(), "path", res.Path, "quality", res.QualityFlag)
	fmt.Printf("OK baked %s/%s: %d ops (%s) → %s\n", res.Key.BlueprintID, res.Key.TaskID, res.Ops, res.QualityFlag, res.Path)
	return nil
}

// bakeAll bakes the WHOLE demo dome in dependency order via bake.BakeAll, prints the
// operator review, and writes it beside the cache as REVIEW.md. A per-Task fallback
// (model exhaustion) does NOT abort — that Task uses the primitive and is listed in
// the review; only a hard build/IO error fails the run.
func bakeAll(m model.Model, store *cache.Store, dir, provider, modelID, baseURL string, timeout time.Duration, visionScorer loop.SilhouetteScorer) error {
	tasks := demoPlanTasks()

	// The vision pass renders the real Scene3D in headless Chrome per task, which
	// is far slower than a generation call, so give the run extra headroom when it
	// is on.
	per := timeout
	if visionScorer != nil {
		per += 60 * time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), per*time.Duration(len(tasks)+1))
	defer cancel()

	slog.Info("baking ALL demo tasks", "provider", provider, "model", modelID, "tasks", len(tasks), "base_url", baseURL, "vision", visionScorer != nil)
	results, review, err := bake.All(ctx, m, store, tasks, bake.DemoContract, provider, modelID, visionScorer)
	if err != nil {
		return fmt.Errorf("bake-all: %w", err)
	}

	for _, r := range results {
		switch {
		case r.FellBack():
			slog.Warn("task fell back", "task", r.TaskID, "reason", r.Result.Reason)
		case r.LowQuality():
			slog.Warn("task cached low-quality", "task", r.TaskID, "reason", r.Result.Reason)
		default:
			slog.Info("task baked", "task", r.TaskID, "ops", r.Result.Ops, "quality", r.Result.QualityFlag)
		}
	}

	summary := review.Summary()
	fmt.Print("\n" + summary)

	reviewPath := filepath.Join(dir, "REVIEW.md")
	if wErr := os.WriteFile(reviewPath, []byte("```\n"+summary+"```\n"), 0o600); wErr != nil {
		return fmt.Errorf("write operator review %q: %w", reviewPath, wErr)
	}
	slog.Info("operator review written", "path", reviewPath, "cached", review.Cached, "fellback", len(review.FellBack), "lowquality", len(review.LowQual))
	return nil
}

// demoPlanTasks adapts the demo dome Blueprint (internal/demo) into the bake
// package's self-contained PlanTask shape (id/type/deps/pos), so bake-all generates
// in the real blueprint's dependency order with the real worksite positions.
func demoPlanTasks() []bake.PlanTask {
	bp := demo.DomeBlueprint()
	tasks := make([]bake.PlanTask, 0, len(bp))
	for _, bt := range bp {
		tasks = append(tasks, bake.PlanTask{
			ID:   bt.Task.ID,
			Type: bt.Task.Type,
			Deps: bt.Task.Deps,
			Pos:  bt.Pos,
		})
	}
	return tasks
}

// buildVisionScorer constructs the bake-time vision scorer when -vision is set,
// else returns nil (analytic-only bake). It wires the SAME model adapter used for
// generation (a vision-capable model id like gpt-4o is required) and the render
// harness config (the built web bundle + a headless Chrome binary). It fails
// LOUDLY when -vision is on but the prerequisites are missing — the live vision
// step must never silently degrade to no-op.
func buildVisionScorer(on bool, m model.Model, root, webDist, chrome string) (loop.SilhouetteScorer, error) {
	if !on {
		return nil, nil //nolint:nilnil // nil scorer ⇒ analytic-only bake, the documented default
	}
	dist := webDist
	if dist == "" {
		dist = filepath.Join(root, "web", "dist")
	}
	if _, err := os.Stat(filepath.Join(dist, "bake-harness.html")); err != nil {
		return nil, fmt.Errorf("-vision needs the built web bundle: %q not found (run `cd web && npm run build`, or pass -web-dist): %w",
			filepath.Join(dist, "bake-harness.html"), err)
	}
	rcfg := vision.RenderConfig{WebDistDir: dist, ChromePath: chrome}
	if !vision.IsChromeAvailable(rcfg) {
		return nil, fmt.Errorf("-vision needs a headless Chrome binary (looked for %q); pass -chrome or set $CHROME_PATH",
			firstNonEmpty(chrome, os.Getenv("CHROME_PATH"), vision.DefaultChromePath))
	}
	slog.Info("vision pass ENABLED", "web_dist", dist, "chrome", firstNonEmpty(chrome, os.Getenv("CHROME_PATH"), vision.DefaultChromePath))
	return vision.LoopScorer{
		Model:  vision.NewScorer(m),
		Render: rcfg,
	}, nil
}

// firstNonEmpty returns the first non-empty string, for logging the resolved
// Chrome path.
func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// resolveBaseURL maps a provider label to its OpenAI-compatible base_url, unless
// an explicit override is given. An unknown provider with no override defaults to
// OpenAI.
func resolveBaseURL(provider, override string) string {
	if override != "" {
		return override
	}
	switch strings.ToLower(provider) {
	case "gemini":
		return model.BaseURLGemini
	case "local":
		return model.BaseURLLocal
	default:
		return model.BaseURLOpenAI
	}
}

// apiKeyEnv is the env var holding the key for a provider. Gemini's
// OpenAI-compatible endpoint takes an OpenAI-style key in GEMINI_API_KEY; local
// (Ollama) needs none but we accept a placeholder so NewOpenAI doesn't reject it.
func apiKeyEnv(provider string) string {
	switch strings.ToLower(provider) {
	case "gemini":
		return "GEMINI_API_KEY"
	case "local":
		return "OPENAI_API_KEY" // any non-empty value; Ollama ignores it
	default:
		return "OPENAI_API_KEY"
	}
}

func apiKeyFor(provider string) string {
	if k := os.Getenv(apiKeyEnv(provider)); k != "" {
		return k
	}
	if strings.EqualFold(provider, "local") {
		return "ollama" // local needs no real key; satisfy the adapter's non-empty check
	}
	return ""
}

// repoRoot walks up from the working directory to the directory containing go.mod,
// so `go run ./cmd/bake` writes to the committed specs dir regardless of CWD.
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("could not find repo root (go.mod) above the working directory")
		}
		dir = parent
	}
}

// loadDotEnv loads KEY=VALUE lines from path into the process environment WITHOUT
// overriding variables already set, and never logs values. Missing file is a
// silent no-op (the key may already be exported). It is intentionally minimal —
// it exists only so the manual bake step is convenient; it is never on any
// runtime path.
func loadDotEnv(path string) {
	f, err := os.Open(path) //nolint:gosec // operator-supplied local .env path for the manual bake
	if err != nil {
		return
	}
	defer func() { _ = f.Close() }()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue // never override an already-set variable
		}
		_ = os.Setenv(key, val)
	}
}
