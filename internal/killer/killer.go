// Package killer is the SwarmBuild "killer sidecar": the one process allowed to
// fail a containerised/pod-hosted Rover for real, so the swarm Self-heals over the
// REAL bus, the same heal as the in-proc headline, proven against a genuinely
// separate system. It subscribes to the dashboard control feed (wire.SubjControl)
// and, on a matching command, maps the target Robot to a kill target (a container
// name or a k8s label selector) and kills it. The killed Rover goes silent on the
// bus, its Lease TTL-expires, and the orphaned task Re-auctions.
//
// Two backends, selected by the injected Kill func (KILLER_BACKEND in cmd/killer):
//   - docker (default): DockerKill runs `docker kill <container>` for the
//     docker-compose container Encore (ADR-0001).
//   - kubectl: KubectlKill runs `kubectl delete pod -l <selector>` for the
//     pod-per-rover swarm, where each Rover is its own pod.
//
// Two commands trigger a kill, gated by Config.ActOnKill:
//   - "killContainer" is ALWAYS handled here (the container Encore). It is
//     deliberately distinct from the soft in-proc "kill" the Robot Agent acts on (a
//     flag-flip); no agent acts on "killContainer".
//   - "kill" (the dashboard's normal KILL) is handled here ONLY when ActOnKill is
//     set. In the pod-per-rover swarm there is no in-proc agent to flip itself
//     dead, so the dashboard's KILL must become a real pod delete. In the
//     docker-compose demo ActOnKill is false, so "kill" stays the agent's soft
//     in-proc death and this sidecar ignores it (backward compatible).
//
// The browser never touches docker.sock or the k8s API: it only emits a control
// frame; this sidecar is the sole holder of the credential (see
// deploy/docker-compose.yml and the k8s RBAC for the kubectl backend).
//
// Security (golang-security, command injection): a browser-controlled Robot id can
// never reach a shell. The allowlist Targets map is the trust boundary: a Robot
// not present in the map can kill NOTHING (the kill is skipped, never errored), and
// the only string passed to docker/kubectl is the operator-configured target (a
// container name or a label selector), via exec argv form (no `sh -c`).
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

// KillFunc kills the named target. It is injected so tests can assert the kill
// path WITHOUT shelling out to docker/kubectl; production wires DockerKill or a
// closure over KubectlKill. The target is always an operator-configured value from
// the allowlist (a container name or a k8s label selector), never a
// browser-controlled string.
type KillFunc func(ctx context.Context, target string) error

// Config is the killer sidecar's static configuration. Targets is the allowlist
// that maps each killable Robot id to its kill target; it is the security boundary
// (only mapped robots can ever be killed). Kill is the injected kill
// implementation (DockerKill or a KubectlKill closure in production).
type Config struct {
	// Targets maps a Robot id to the target the sidecar may kill for it: a
	// container name for the docker backend, or a label selector (e.g. "rover=R3")
	// for the kubectl backend. A Robot absent from this map is never killable: its
	// kill is ignored. Populated from -targets / KILLER_TARGETS (see ParseTargets).
	Targets map[domain.RobotID]string
	// Kill performs the actual kill. Required.
	Kill KillFunc
	// ActOnKill makes the sidecar ALSO act on the dashboard's normal "kill" command,
	// in addition to "killContainer". It is the pod-per-rover switch: with no
	// in-proc agent to flip itself dead, the dashboard's KILL must become a real pod
	// delete. Default false keeps the docker-compose demo backward compatible: only
	// "killContainer" is handled here and "kill" stays the agent's soft in-proc
	// death. Set from KILLER_ON_KILL (see cmd/killer).
	ActOnKill bool
}

// Run subscribes to the control feed and dispatches kill commands until ctx is
// cancelled. The subscription callback runs on the NATS dispatcher goroutine and
// only maps + kills; it owns no shared state. Run blocks until ctx is done, then
// unsubscribes and returns ctx.Err().
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

	slog.Info("killer ready", "targets", len(cfg.Targets), "act_on_kill", cfg.ActOnKill)

	<-ctx.Done()
	return ctx.Err()
}

// handle dispatches one control frame. A "killContainer" always triggers a kill;
// the dashboard's normal "kill" triggers one only when ActOnKill is set (the
// pod-per-rover mode). Every other command, and any unmapped/unknown Robot, is a
// logged no-op, never an error (a hostile or stray frame must not take the sidecar
// down). This is the security guard: the allowlist lookup is the sole gate to the
// real kill.
func handle(ctx context.Context, cfg Config, c wire.Control) {
	if !cfg.kills(c.Cmd) {
		return // not ours: the soft in-proc "kill" (when ActOnKill is off) and the sliders are handled elsewhere
	}

	target, ok := cfg.Targets[c.Robot]
	if !ok {
		// Unmapped/unknown Robot: ignored, never an error. A Robot id not in the
		// allowlist can kill nothing: the security boundary holds even for a
		// browser-controlled or garbled id.
		slog.Info("kill ignored: unmapped robot", "cmd", c.Cmd, "robot", c.Robot)
		return
	}

	slog.Info("kill", "cmd", c.Cmd, "robot", c.Robot, "target", target)
	if err := cfg.Kill(ctx, target); err != nil {
		// A failed kill is logged and swallowed: the sidecar stays up to serve the
		// next command, and the Lease still TTL-expires if the Rover did die.
		// Returning would tear down the only process that can heal.
		slog.Error("kill failed", "cmd", c.Cmd, "robot", c.Robot, "target", target, "error", err)
	}
}

// kills reports whether the sidecar acts on the given control command:
// "killContainer" always, and "kill" only when ActOnKill is set. Keeping the gate
// here makes the backward-compatible default (act on "killContainer" only) explicit.
func (cfg Config) kills(cmd string) bool {
	switch cmd {
	case "killContainer":
		return true
	case "kill":
		return cfg.ActOnKill
	default:
		return false
	}
}

// DockerKill is the docker-backend KillFunc: it runs `docker kill <container>` via
// exec argv form (NO shell), so the container name is passed as a single argument
// and can never be interpreted as a shell command (golang-security: command
// injection). container always comes from the operator-configured allowlist.
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

// KubectlKill is the kubectl-backend KillFunc: it runs
// `kubectl delete pod -l <selector> -n <namespace> --grace-period=0
// --ignore-not-found` via exec argv form (NO shell), deleting the pod(s) that
// match the operator-configured label selector for one Rover. --grace-period=0
// drops the pod immediately so its heartbeats stop and the Lease TTL-expires;
// --ignore-not-found makes a re-kill (or a Rover that already died) a clean no-op.
//
// selector and namespace are both operator-configured (Config.Targets and
// KILLER_NAMESPACE), never browser-controlled, and are each passed as a single
// argv element (golang-security: command injection). The namespace is closed over
// by cmd/killer when wiring this as the KillFunc, keeping the injected signature
// the same plain func(ctx, target) as DockerKill.
func KubectlKill(ctx context.Context, namespace, selector string) error {
	// G204: namespace and selector are operator-configured allowlist values
	// (KILLER_NAMESPACE and Config.Targets), never browser-controlled strings, and
	// are each passed as single argv elements to kubectl (no shell), so neither can
	// be interpreted as a command. This is the documented security guard of the
	// killer sidecar (same guard as DockerKill).
	//nolint:gosec // namespace/selector come only from operator config; argv form, no shell.
	cmd := exec.CommandContext(ctx, "kubectl", "delete", "pod",
		"-l", selector, "-n", namespace, "--grace-period=0", "--ignore-not-found")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("kubectl delete pod -l %s -n %s: %w: %s", selector, namespace, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// ParseTargets parses the -targets / KILLER_TARGETS spec into the allowlist map.
// The spec is comma-separated "Robot=target" pairs. For the docker backend the
// target is a container name, e.g. "R7=swarmbuild-rover-encore"; for the kubectl
// backend it is a label selector, e.g. "R3=rover=R3" (the value itself contains an
// "="). The pair is split on the FIRST "=" only (strings.Cut), so a selector value
// with its own "=" parses correctly: "R3=rover=R3" yields robot "R3", target
// "rover=R3". Whitespace around each pair and side is trimmed; empty entries are
// skipped. A malformed pair (no "=", empty Robot, or empty target) is an error so a
// typo in deploy config fails fast rather than silently disabling a kill target.
func ParseTargets(spec string) (map[domain.RobotID]string, error) {
	targets := make(map[domain.RobotID]string)
	for pair := range strings.SplitSeq(spec, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		// Cut on the FIRST "=" so a kubectl label-selector target (e.g. "rover=R3")
		// keeps its own "=" intact: only the Robot id is taken before it.
		robot, target, ok := strings.Cut(pair, "=")
		robot = strings.TrimSpace(robot)
		target = strings.TrimSpace(target)
		if !ok || robot == "" || target == "" {
			return nil, fmt.Errorf("killer: malformed target %q: want robot=target", pair)
		}
		targets[domain.RobotID(robot)] = target
	}
	return targets, nil
}
