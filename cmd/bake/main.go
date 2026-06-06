// Command bake is the SwarmBuild offline generation step (TECHSPEC §3/§4,
// ADR-0007): it generates ONE demo Task's Build spec via a GPT-class model and
// writes it to the committed cache, so the headline replays it deterministically
// with no live model call. It is the ONLY binary that reaches the Model seam.
//
// Usage:
//
//	set -a; . ./.env; set +a            # load OPENAI_API_KEY (never commit .env)
//	go run ./cmd/bake -task foundation-1 -type foundation
//
// Flags select the demo Task, provider (base_url swap) and model id. The API key
// is read from the environment ONLY (OPENAI_API_KEY) and never logged or shipped
// anywhere near the browser. On model exhaustion bake exits non-zero and writes
// nothing — the demo Task then falls back to the primitive geometry.
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
	"swarmbuild/internal/harness/bake"
	"swarmbuild/internal/harness/cache"
	"swarmbuild/internal/harness/model"
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
		timeout  = flag.Duration("timeout", 60*time.Second, "overall generation timeout")
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

	dir := *outDir
	if dir == "" {
		root, rErr := repoRoot()
		if rErr != nil {
			return rErr
		}
		dir = cache.DefaultStoreDir(root)
	}
	store, err := cache.NewStore(dir)
	if err != nil {
		return err
	}

	contract, err := bake.DemoContract(domain.TaskID(*taskID), domain.TaskType(*taskType))
	if err != nil {
		return err
	}
	world := bake.WorldContext{Note: "demo dome on the lunar surface; build in the Task envelope frame"}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	slog.Info("baking", "provider", *provider, "model", *modelID, "task", *taskID, "type", *taskType, "base_url", baseURLResolved)
	res, err := bake.Bake(ctx, m, store, contract, world, *provider, *modelID)
	if err != nil {
		if errors.Is(err, model.ErrFallback) {
			return fmt.Errorf("generation exhausted (validate-and-repair gave up): %w — demo will use the primitive fallback; nothing cached", err)
		}
		return err
	}

	slog.Info("baked", "ops", res.Ops, "key", res.Key.Filename(), "path", res.Path)
	fmt.Printf("OK baked %s/%s: %d ops → %s\n", res.Key.BlueprintID, res.Key.TaskID, res.Ops, res.Path)
	return nil
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
