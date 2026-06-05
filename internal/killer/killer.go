// Package killer is the SwarmBuild "killer sidecar": the one process allowed to
// touch docker.sock and perform a real `docker kill` on a containerised Rover for
// the container Encore (ADR-0001). It subscribes to the dashboard control feed
// (wire.SubjControl) and, on a wire.Control{Cmd:"killContainer"}, maps the target
// Robot to a container name and kills it. The killed container goes silent on the
// bus, its Lease TTL-expires, and the swarm Self-heals by Re-auction over the REAL
// bus — the same heal as the in-proc headline, proven against a genuinely separate
// system.
//
// This is deliberately distinct from the soft in-proc "kill" the Robot Agent acts
// on (a flag-flip): "killContainer" is consumed ONLY here. The browser never sees
// docker.sock — it only emits a control frame; this sidecar is the sole holder of
// the socket (see deploy/docker-compose.yml).
//
// Security (golang-security, command injection): a browser-controlled Robot id can
// never reach a shell. The allowlist Targets map is the trust boundary — a Robot
// not present in the map can kill NOTHING (the kill is skipped, never errored), and
// the only string passed to docker is the operator-configured container name, via
// exec argv form (no `sh -c`).
package killer

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os/exec"
	"strings"
	"swarmbuild/internal/bus"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/wire"
)

// KillFunc kills the named container. It is injected so tests can assert the kill
// path WITHOUT shelling out to docker; production wires DockerKill. The container
// is always an operator-configured name from the allowlist, never a
// browser-controlled string.
type KillFunc func(ctx context.Context, container string) error

// Config is the killer sidecar's static configuration. Targets is the allowlist
// that maps each killable Robot id to its container name; it is the security
// boundary (only mapped robots can ever be killed). Kill is the injected kill
// implementation (DockerKill in production).
type Config struct {
	// Targets maps a Robot id to the container name the sidecar may kill for it.
	// A Robot absent from this map is never killable — its killContainer is
	// ignored. Populated from -targets / KILLER_TARGETS (see ParseTargets).
	Targets map[domain.RobotID]string
	// Kill performs the actual container kill. Required.
	Kill KillFunc
}

// Run subscribes to the control feed and dispatches killContainer commands until
// ctx is cancelled. The subscription callback runs on the NATS dispatcher
// goroutine and only maps + kills; it owns no shared state. Run blocks until ctx
// is done, then unsubscribes and returns ctx.Err().
func Run(ctx context.Context, conn *bus.Conn, cfg Config) error {
	if cfg.Kill == nil {
		return errors.New("killer: Kill func is required")
	}

	unsub, err := bus.SubscribeJSON(conn, wire.SubjControl, func(c wire.Control) {
		handle(ctx, cfg, c)
	})
	if err != nil {
		return fmt.Errorf("killer: subscribe control: %w", err)
	}
	defer unsub()

	slog.Info("killer ready", "targets", len(cfg.Targets))

	<-ctx.Done()
	return ctx.Err()
}

// handle dispatches one control frame. Only "killContainer" for a Robot in the
// allowlist triggers a kill; every other command, and any unmapped/unknown Robot,
// is a logged no-op — never an error (a hostile or stray frame must not take the
// sidecar down). This is the security guard: the allowlist lookup is the sole gate
// to docker kill.
func handle(ctx context.Context, cfg Config, c wire.Control) {
	if c.Cmd != "killContainer" {
		return // not ours: the soft in-proc "kill" and the sliders are handled elsewhere
	}

	container, ok := cfg.Targets[c.Robot]
	if !ok {
		// Unmapped/unknown Robot: ignored, never an error. A Robot id not in the
		// allowlist can kill nothing — the security boundary holds even for a
		// browser-controlled or garbled id.
		slog.Info("killContainer ignored: unmapped robot", "robot", c.Robot)
		return
	}

	slog.Info("killContainer", "robot", c.Robot, "container", container)
	if err := cfg.Kill(ctx, container); err != nil {
		// A failed docker kill is logged and swallowed: the sidecar stays up to
		// serve the next command, and the Lease still TTL-expires if the container
		// did die. Returning would tear down the only process that can heal.
		slog.Error("docker kill failed", "robot", c.Robot, "container", container, "error", err)
	}
}

// DockerKill is the production KillFunc: it runs `docker kill <container>` via exec
// argv form (NO shell), so the container name is passed as a single argument and
// can never be interpreted as a shell command (golang-security: command injection).
// container always comes from the operator-configured allowlist.
func DockerKill(ctx context.Context, container string) error {
	// G204: container is an operator-configured allowlist value (Config.Targets),
	// never a browser-controlled string, and is passed as a single argv element to
	// docker (no shell), so it cannot be interpreted as a command. This is the
	// documented security guard of the killer sidecar.
	//nolint:gosec // container comes only from the operator allowlist; argv form, no shell.
	cmd := exec.CommandContext(ctx, "docker", "kill", container)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("docker kill %s: %w: %s", container, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ParseTargets parses the -targets / KILLER_TARGETS spec into the allowlist map.
// The spec is comma-separated "Robot=container" pairs, e.g.
// "R7=swarmbuild-rover-encore,R8=swarmbuild-rover-encore-2". Whitespace around
// each pair and side is trimmed; empty entries are skipped. A malformed pair (no
// "=", empty Robot, or empty container) is an error so a typo in deploy config
// fails fast rather than silently disabling a kill target.
func ParseTargets(spec string) (map[domain.RobotID]string, error) {
	targets := make(map[domain.RobotID]string)
	for pair := range strings.SplitSeq(spec, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		robot, container, ok := strings.Cut(pair, "=")
		robot = strings.TrimSpace(robot)
		container = strings.TrimSpace(container)
		if !ok || robot == "" || container == "" {
			return nil, fmt.Errorf("killer: malformed target %q: want robot=container", pair)
		}
		targets[domain.RobotID(robot)] = container
	}
	return targets, nil
}
