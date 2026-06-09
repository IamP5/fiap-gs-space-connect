package archtest

import (
	"os/exec"
	"strings"
	"testing"
)

const modelPkg = "swarmbuild/internal/harness/model"

var modelWiringPkgs = []string{
	"swarmbuild/internal/harness/loop",
	"swarmbuild/internal/harness/bake",
	"swarmbuild/internal/harness/live",
}

const livePkg = "swarmbuild/internal/harness/live"

const agentPkg = "swarmbuild/internal/agent"

var hotPathPkgs = []string{
	"swarmbuild/internal/core/allocation",
	"swarmbuild/internal/core/lease",
	"swarmbuild/internal/core/world",
	"swarmbuild/internal/core/planner",
	"swarmbuild/internal/coordinator",
}

func goAvailable() bool {
	_, err := exec.LookPath("go")
	return err == nil
}

func deps(t *testing.T, pkg string) []string {
	t.Helper()
	//nolint:gosec // G204: pkg is a fixed in-repo package path from hotPathPkgs, not user input.
	out, err := exec.CommandContext(t.Context(), "go", "list", "-deps", pkg).CombinedOutput()
	if err != nil {
		t.Fatalf("go list -deps %s failed: %v\n%s", pkg, err, out)
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	deps := make([]string, 0, len(lines))
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			deps = append(deps, l)
		}
	}
	return deps
}

func TestModelSeamOffHotPath(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping import-graph arch test")
	}
	forbidden := append([]string{modelPkg}, modelWiringPkgs...)
	for _, pkg := range hotPathPkgs {
		t.Run(pkg, func(t *testing.T) {
			closure := make(map[string]bool)
			for _, dep := range deps(t, pkg) {
				closure[dep] = true
			}
			for _, bad := range forbidden {
				if closure[bad] {
					t.Fatalf("ARCH VIOLATION: hot-path package %s imports %s "+
						"(ADR-0005: no model call on award/heartbeat/expiry/tick). "+
						"Move the generation behind the live path.", pkg, bad)
				}
			}
		})
	}
}

func TestArchTestGuardsTheRightSeam(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping arch self-check")
	}
	var foundOpenAI bool
	for _, dep := range deps(t, modelPkg) {
		if strings.Contains(dep, "openai/openai-go") {
			foundOpenAI = true
			break
		}
	}
	if !foundOpenAI {
		t.Fatalf("expected the Model seam %s to import openai-go (so the arch boundary is real)", modelPkg)
	}
}

func TestLiveSeamIsReal(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping live arch self-check")
	}
	var foundModel, foundLoop bool
	for _, dep := range deps(t, livePkg) {
		if dep == modelPkg {
			foundModel = true
		}
		if dep == "swarmbuild/internal/harness/loop" {
			foundLoop = true
		}
	}
	if !foundModel {
		t.Fatalf("expected the live adapter %s to import the Model seam %s (so it is a real model boundary)", livePkg, modelPkg)
	}
	if !foundLoop {
		t.Fatalf("expected the live adapter %s to import the refine loop (so it drives real generation)", livePkg)
	}
}

func TestAgentReachesModelOnlyViaInjectedSeam(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping agent-model arch test")
	}
	forbidden := append([]string{modelPkg, livePkg}, modelWiringPkgs...)
	closure := make(map[string]bool)
	for _, dep := range deps(t, agentPkg) {
		closure[dep] = true
	}
	for _, bad := range forbidden {
		if closure[bad] {
			t.Fatalf("ARCH VIOLATION: agent package %s imports %s — Live Build Mode (bh-08) must reach "+
				"the Model seam ONLY through the injected agent.LiveBuilder interface, keeping the agent "+
				"(and the coordinator that imports it) off the model's static import graph.", agentPkg, bad)
		}
	}
}

func TestGatewayDoesNotImportModel(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping gateway-model arch test")
	}
	const gatewayPkg = "swarmbuild/internal/gateway"
	forbidden := append([]string{modelPkg}, modelWiringPkgs...)
	closure := make(map[string]bool)
	for _, dep := range deps(t, gatewayPkg) {
		closure[dep] = true
	}
	for _, bad := range forbidden {
		if closure[bad] {
			t.Fatalf("ARCH VIOLATION: gateway package %s imports %s — the HTTP fan-out must stay "+
				"off the model's import graph.", gatewayPkg, bad)
		}
	}
}
