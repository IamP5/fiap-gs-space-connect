// Package archtest holds the import-graph architecture test that PROMOTES
// TECHSPEC §8's manual grep into an executable check (ADR-0005): it asserts the
// Model seam (internal/harness/model) is NOT in the import closure of the
// deterministic SELF-HEAL CORE. A live model call wired onto an award, a
// heartbeat, an expiry, or the single-writer tick would pull the model package
// into one of those closures and fail this test in `go test` / CI.
//
// SCOPE (bh-08, ADR-0005 scoped break): the protected boundary is the self-heal
// core — allocation/auction, lease/heartbeat, expiry, the single-writer tick
// (core/world, core/planner, core/allocation, core/lease) AND the coordinator hot
// path. Those MUST stay model-free. Live Build Mode (bh-08) deliberately runs the
// Model seam in the ROVER's work phase (internal/agent, live mode) — the agent
// reaches the Model seam only through an INJECTED seam (agent.LiveBuilder,
// implemented by internal/harness/live and wired by cmd/agent), so the agent
// PACKAGE still does not statically import the model — which is exactly what
// keeps the coordinator (which imports agent) model-free.
//
// It is dependency-free: it shells out to `go list -deps` and inspects the
// package list, skipping gracefully if the go toolchain is unavailable (so the
// suite still passes in a minimal CI image without go on PATH).
package archtest

import (
	"os/exec"
	"strings"
	"testing"
)

// modelPkg is the Model seam that must stay OFF the hot path.
const modelPkg = "swarmbuild/internal/harness/model"

// modelWiringPkgs are the packages that wire the Model seam into the
// Generator↔Evaluator loop (ADR-0008). They import the Model seam, so they MUST
// stay off the hot path too — a hot-path package importing any of them would pull
// a live model call onto an award/heartbeat/expiry. The model-seam check below
// already catches this transitively; these are named explicitly so the boundary's
// intent is legible and a future refactor that hides the model import behind one
// of them still fails this test.
var modelWiringPkgs = []string{
	"swarmbuild/internal/harness/loop", // Generator↔Evaluator refine loop
	"swarmbuild/internal/harness/bake", // Build contracts + prompt assembly (drives the loop)
	"swarmbuild/internal/harness/live", // bh-08 Live Build Mode adapter (drives the loop on a live model call)
}

// livePkg is the bh-08 Live Build Mode adapter: the model-backed implementation of
// agent.LiveBuilder. It drives the refine loop on a LIVE model call in the Rover's
// work phase, so it reaches the Model seam and MUST stay off the self-heal core's
// import closure (the modelWiringPkgs check enforces it; TestLiveSeamIsReal
// confirms the boundary is real). The Rover reaches it only through the injected
// agent.LiveBuilder seam, so the agent package never imports it.
const livePkg = "swarmbuild/internal/harness/live"

// agentPkg is the Robot Agent (the Rover). In Live Build Mode (bh-08) its work
// phase runs the Model seam — but ONLY through the injected agent.LiveBuilder
// interface, NOT a static import. So the agent package itself must still NOT import
// the Model seam (or any model-wiring package): that is what keeps the coordinator,
// which imports the agent, off the model's import graph. The break is scoped to the
// injected call, not the static dependency graph.
const agentPkg = "swarmbuild/internal/agent"

// hotPathPkgs are the deterministic SELF-HEAL CORE packages on the live path of an
// award, a lease renewal/heartbeat, an expiry, and the single-writer tick
// (TECHSPEC §8, ADR-0005). None of them may import the Model seam, directly or
// transitively. The Rover's work phase (internal/agent, live mode) is NO LONGER on
// this list — bh-08 deliberately runs the model there — but the coordinator stays,
// so the agent must keep the Model seam behind its injected LiveBuilder seam (see
// TestAgentReachesModelOnlyViaInjectedSeam).
var hotPathPkgs = []string{
	"swarmbuild/internal/core/allocation", // auction / cost function
	"swarmbuild/internal/core/lease",      // lease + heartbeat + expiry
	"swarmbuild/internal/core/world",      // single-writer World Model state
	"swarmbuild/internal/core/planner",    // ready-task planning
	"swarmbuild/internal/coordinator",     // single-writer tick + award/expiry orchestration
}

// goAvailable reports whether the go toolchain is on PATH, so the test can skip
// (not fail) in an environment without it.
func goAvailable() bool {
	_, err := exec.LookPath("go")
	return err == nil
}

// deps returns the full transitive import closure of pkg via `go list -deps`. Each
// output line is one package path. A non-zero exit (e.g. a build error elsewhere)
// fails the test with the toolchain's diagnostics.
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

// TestModelSeamOffHotPath asserts the Model seam is absent from every hot-path
// package's import closure (ADR-0005's mechanical enforcement).
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

// TestArchTestGuardsTheRightSeam is a meta-guard: it confirms the Model seam
// package itself exists and DOES pull in a network-ish dep (openai-go), so the
// test above is checking a real boundary rather than a non-existent package whose
// absence would make the assertion vacuously pass.
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

// TestLiveSeamIsReal is the bh-08 meta-guard: it confirms the Live Build Mode
// adapter genuinely pulls in the Model seam AND the refine loop, so the "live off
// the self-heal core" assertion in TestModelSeamOffHotPath (via modelWiringPkgs)
// guards a real, network-capable boundary rather than a vacuous one.
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

// TestAgentReachesModelOnlyViaInjectedSeam is the bh-08 boundary guard and the
// load-bearing half of the ADR-0005 rescope: Live Build Mode runs the Model seam in
// the Rover's work phase, but ONLY through the injected agent.LiveBuilder interface.
// So the agent PACKAGE itself must still NOT import the Model seam, the refine loop,
// or any model-wiring package — that static cleanliness is precisely what keeps the
// coordinator (which imports the agent) off the model's import graph
// (TestModelSeamOffHotPath). A refactor that imports the model or the live adapter
// directly into the agent package fails here AND would cascade into the
// coordinator's hot-path check.
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

// TestGatewayDoesNotImportModel is the boundary guard for the HTTP fan-out: the
// gateway PACKAGE must NOT import the Model seam or any model-wiring package,
// keeping the snapshot fan-out off the model's import graph.
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
