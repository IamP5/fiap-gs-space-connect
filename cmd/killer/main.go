// Command killer runs the SwarmBuild killer sidecar (ADR-0001): the one process
// allowed to fail a containerised/pod-hosted Rover for real. It joins the swarm bus
// as a plain NATS client, listens for the dashboard's control frames, and kills the
// mapped Rover so its Lease TTL-expires and the swarm Self-heals by Re-auction over
// the real bus. The browser never touches docker.sock or the k8s API: it only emits
// the control frame; this sidecar is the sole holder of the credential (see
// deploy/docker-compose.yml and the k8s RBAC for the kubectl backend).
//
// Two backends, selected by KILLER_BACKEND:
//   - docker (default): `docker kill <container>` for the docker-compose Encore.
//   - kubectl: `kubectl delete pod -l <selector>` in KILLER_NAMESPACE for the
//     pod-per-rover swarm (each Rover is its own pod).
//
// KILLER_ON_KILL=true also acts on the dashboard's normal KILL ("kill"), not just
// "killContainer": in the pod-per-rover swarm there is no in-proc agent to flip
// itself dead, so the dashboard's KILL must become a real pod delete. The default
// (false) keeps the docker-compose demo backward compatible.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/killer"
	"syscall"
	"time"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := run(); err != nil {
		slog.Error("killer failed", "error", err)
		os.Exit(1)
	}
}

// run wires the sidecar from flags/env, connects to the bus, and serves until the
// context is cancelled. It is split out from main so the deferred cleanup (signal
// stop, connection close) actually runs before the process exits on error: a fatal
// log inside main would skip every defer (mirrors cmd/agent/main.go).
func run() error {
	var (
		targets   = flag.String("targets", "", "robot→target allowlist (comma-separated); container name for the docker backend (R7=swarmbuild-rover-encore) or a label selector for the kubectl backend (R3=rover=R3); overrides KILLER_TARGETS")
		natsURL   = flag.String("nats-url", "", "NATS URL (overrides NATS_URL env)")
		backend   = flag.String("backend", "", "kill backend: docker (default) | kubectl; overrides KILLER_BACKEND")
		namespace = flag.String("namespace", "", "k8s namespace for the kubectl backend (default swarmbuild); overrides KILLER_NAMESPACE")
		onKill    = flag.Bool("on-kill", false, "also act on the dashboard's normal KILL (\"kill\"), not just \"killContainer\"; overrides KILLER_ON_KILL")
	)
	flag.Parse()

	spec := *targets
	if spec == "" {
		spec = os.Getenv("KILLER_TARGETS")
	}
	allowlist, err := killer.ParseTargets(spec)
	if err != nil {
		return err
	}

	url := *natsURL
	if url == "" {
		url = os.Getenv("NATS_URL")
	}
	if url == "" {
		url = "nats://127.0.0.1:4222"
	}

	// KILLER_ON_KILL gates whether the dashboard's normal KILL becomes a real kill
	// here. Default false keeps the docker-compose demo unchanged ("kill" stays the
	// agent's soft in-proc death). The flag wins when set; otherwise the env decides.
	actOnKill := *onKill || os.Getenv("KILLER_ON_KILL") == "true"

	// KILLER_BACKEND selects the production KillFunc: docker (default) wires
	// DockerKill; kubectl wires a closure over KubectlKill that closes over the
	// operator-configured namespace, keeping the injected KillFunc signature the
	// plain func(ctx, target) the sidecar expects.
	backendName := *backend
	if backendName == "" {
		backendName = os.Getenv("KILLER_BACKEND")
	}
	killFn, err := selectKill(backendName, *namespace)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	slog.Info("killer connecting", "nats_url", url, "targets", len(allowlist), "backend", backendName, "act_on_kill", actOnKill)
	conn, err := bus.Connect(ctx, url, bus.ConnectOptions{
		Name:    "killer",
		MaxWait: 30 * time.Second,
	})
	if err != nil {
		return err
	}
	defer conn.Close()

	if err := killer.Run(ctx, conn, killer.Config{
		Targets:   allowlist,
		Kill:      killFn,
		ActOnKill: actOnKill,
	}); err != nil && ctx.Err() == nil {
		return err
	}
	slog.Info("killer shut down")
	return nil
}

// selectKill maps KILLER_BACKEND to the production KillFunc. docker (the default)
// wires DockerKill; kubectl wires a closure that pins the operator-configured
// namespace onto KubectlKill so the injected func stays func(ctx, target). An
// unknown backend is an error so a typo in deploy config fails fast.
func selectKill(backend, namespace string) (killer.KillFunc, error) {
	switch backend {
	case "", "docker":
		return killer.DockerKill, nil
	case "kubectl":
		if namespace == "" {
			namespace = os.Getenv("KILLER_NAMESPACE")
		}
		if namespace == "" {
			namespace = "swarmbuild"
		}
		// Close the operator-configured namespace over KubectlKill so the injected
		// KillFunc stays the plain func(ctx, selector) the sidecar dispatches; the
		// selector itself still comes only from the allowlist (Config.Targets).
		return func(ctx context.Context, selector string) error {
			return killer.KubectlKill(ctx, namespace, selector)
		}, nil
	default:
		return nil, fmt.Errorf("killer: unknown backend %q: want docker or kubectl", backend)
	}
}
