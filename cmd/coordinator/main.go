// Command coordinator runs the SwarmBuild coordinator against the NATS bus named
// by NATS_URL. It is the live brain behind the dashboard: it loads the scripted
// demo scenario from the demo package (the lunar habitat dome, the six-rover
// swarm, and the reproducible rehearsal kill) and spawns the in-process rovers
// that build it — including the kill → self-heal money shot, paced so a
// first-time viewer can read it (slice 06).
//
// COORDINATOR_ROVERS=external switches to pod-per-rover mode: the coordinator
// spawns no in-process rovers and arms no scripted kill; rovers join over NATS as
// their own containers/pods and the dashboard's KILL is a real pod delete.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"swarmbuild/internal/coordinator"
	"swarmbuild/internal/demo"
	"swarmbuild/internal/harness/live"
	"swarmbuild/internal/harness/model"
	"syscall"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("coordinator failed", "error", err)
		os.Exit(1)
	}
}

// run loads the scripted demo scenario and runs the coordinator until the
// context is cancelled. It is split out from main so the deferred signal stop
// runs before the process exits on error.
func run() error {
	natsURL := os.Getenv("NATS_URL")
	if natsURL == "" {
		natsURL = "nats://127.0.0.1:4222"
	}

	// The whole demo — board, swarm, pacing, and the scripted kill — comes from
	// the demo package, the single server-authoritative home for the
	// choreography. Every visual beat the browser draws is triggered by a real
	// engine event emitted while this scenario runs; demo only sets WHEN the
	// rehearsal kill fires and HOW WIDE the timing windows are.
	//
	// COORDINATOR_ROVERS selects how the swarm is hosted:
	//   - "inproc" (default/empty): the coordinator spawns the six-rover swarm
	//     in-process and arms the reproducible rehearsal kill — the docker-compose
	//     demo, byte-for-byte unchanged.
	//   - "external": pod-per-rover mode. The coordinator spawns NO rovers and arms
	//     NO scripted kill; rovers join over NATS as their own containers/pods, and
	//     the dashboard's KILL is a real pod delete (the killer sidecar's kubectl
	//     backend, KILLER_BACKEND=kubectl). The coordinator still runs the auction,
	//     the Lease Manager, the World Model, and snapshots, and the swarm
	//     Self-heals over the real bus.
	//   - "cinematic" (Epic 07, ADR-0011): the demo pacing for the 2:30 shooting
	//     script. It KEEPS the in-process six-rover swarm but DISARMS the early
	//     scripted auto-kill — the operator owns the Kill. The hero wall (lunar/wall-1)
	//     is held un-leasable until a cueKill control arrives; the dome builds
	//     everything else first, then the operator fires the cue at the climax and the
	//     Coordinator orchestrates release → lease → in-process kill → Self-heal. Runs
	//     against the k8s pod-per-rover overlay (#160) where the kill darkens the
	//     victim's pod-agent in place (KILLER_ON_KILL=false), never a pod delete.
	pacing := demo.Rehearsal()
	switch os.Getenv("COORDINATOR_ROVERS") {
	case "external":
		pacing = demo.External()
	case "cinematic":
		pacing = demo.Cinematic()
	}
	cfg := demo.DomeScenario(natsURL, pacing)

	// Live Build Mode (bh-08): when an API key is configured SERVER-SIDE, give the
	// in-process demo rovers the model-backed LiveBuilder seam, so a Blueprint dropped
	// in "live" mode on the dashboard (bh-08c per-Task toggle) actually runs the
	// Generator↔Evaluator loop and streams geometry into the world. The rovers keep
	// ModeReplay as their default, so the headline demo stays the deterministic replay
	// headline UNLESS the operator opts a placement into live (effectiveMode: the
	// per-Task tag wins). With NO key the builder is nil and every Task replays —
	// byte-for-byte the pre-08 path. The key is read server-side only
	// (model.Config.APIKey) and never reaches the browser; the coordinator LIBRARY
	// never imports the Model seam — only this composition root does (ADR-0005).
	if builder, ok := buildLiveFromEnv(); ok {
		for i := range cfg.Rovers {
			cfg.Rovers[i].LiveBuilder = builder
		}
		slog.Info("live build mode available: in-process rovers wired with the Model seam; drop a Blueprint in live mode to use it", "rovers", len(cfg.Rovers))
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("coordinator starting", "nats_url", natsURL)
	if err := coordinator.Run(ctx, cfg); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("coordinator shut down")
	return nil
}

// buildLiveFromEnv constructs the live Build harness seam from the environment, or
// returns ok=false when no API key is configured — in which case the in-process
// rovers get no LiveBuilder and the demo is byte-for-byte the deterministic replay
// path (bh-08). It mirrors cmd/agent's buildLive and cmd/{bake,gateway}'s provider
// swap: LAB_PROVIDER / LAB_MODEL select the provider + model, the matching *_API_KEY
// authenticates it. The key is read SERVER-SIDE only and never logged or shipped to
// the browser; the agent package itself never imports the Model seam (ADR-0005).
func buildLiveFromEnv() (*live.Builder, bool) {
	provider := strings.ToLower(getenv("LAB_PROVIDER", "openai"))
	modelID := getenv("LAB_MODEL", "gpt-4o-2024-08-06")
	apiKey, baseURL := keyAndBaseURL(provider)
	if apiKey == "" {
		return nil, false // no key ⇒ stay pure replay, the demo unchanged
	}
	m, err := model.NewOpenAI(model.Config{
		Provider: provider,
		BaseURL:  baseURL,
		Model:    modelID,
		APIKey:   apiKey, // server-side only; never reaches the browser
	})
	if err != nil {
		slog.Warn("live build mode requested but Model seam init failed; staying replay", "error", err)
		return nil, false
	}
	// The rovers keep ModeReplay as their Config default; the per-Task live tag
	// (bh-08c effectiveMode) is what opts a specific placement into this builder.
	return live.NewBuilder(m, provider, modelID), true
}

// keyAndBaseURL resolves the API key + OpenAI-compatible base_url for a provider
// from the environment, mirroring cmd/{agent,bake,gateway}'s provider swap.
func keyAndBaseURL(provider string) (apiKey, baseURL string) {
	switch provider {
	case "gemini":
		return os.Getenv("GEMINI_API_KEY"), model.BaseURLGemini
	case "local":
		// Ollama needs no real key; accept a placeholder so the adapter's non-empty
		// check passes and local live builds run with no cloud key.
		k := os.Getenv("OPENAI_API_KEY")
		if k == "" {
			k = "ollama"
		}
		return k, model.BaseURLLocal
	default:
		return os.Getenv("OPENAI_API_KEY"), model.BaseURLOpenAI
	}
}

// getenv returns the environment value for key, or def when it is unset/empty.
func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
