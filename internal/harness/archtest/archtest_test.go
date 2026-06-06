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
// Model seam in the ROVER's work phase (internal/agent, live mode) — so the agent
// is NO LONGER held to "absent from the import closure". The agent reaches the
// Model seam only through an INJECTED seam (agent.LiveBuilder, implemented by
// internal/harness/live and wired by cmd/agent), so the agent PACKAGE still does
// not statically import the model — which is exactly what keeps the coordinator
// (which imports agent) model-free. TestAgentReachesModelOnlyViaInjectedSeam
// guards that, and TestLiveSeamIsReal proves the live adapter is a real model
// boundary.
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

// labModelPkgs are the bh-04 lab/bake packages that wire the Model seam into the
// Generator↔Evaluator loop (ADR-0008). They import the Model seam, so they MUST
// stay off the hot path too — a hot-path package importing any of them would pull a
// live model call onto an award/heartbeat/expiry. The model-seam check below already
// catches this transitively; these are named explicitly so the boundary's intent is
// legible and a future refactor that hides the model import behind one of them still
// fails this test.
var labModelPkgs = []string{
	"swarmbuild/internal/harness/loop",   // Generator↔Evaluator refine loop
	"swarmbuild/internal/harness/bake",   // offline bake / bake-all (drives the loop)
	"swarmbuild/internal/harness/vision", // bh-06 bake-time vision pass (model + headless Chrome)
	"swarmbuild/internal/harness/lab",    // bh-07a in-app LIVE lab (drives the loop on a live model call)
	"swarmbuild/internal/harness/live",   // bh-08 Live Build Mode adapter (drives the loop on a live model call)
}

// labPkg is the bh-07a in-app live lab: it runs the real Generator↔Evaluator loop
// on a LIVE model call and streams it to the dashboard. It reaches the Model seam,
// so it MUST stay off the hot path (the labModelPkgs check enforces it, and
// TestLabSeamIsReal below confirms the boundary is real). The gateway reaches it
// only through an injected interface, so the gateway package itself never imports
// it — keeping the gateway off the model's import graph too.
const labPkg = "swarmbuild/internal/harness/lab"

// visionPkg is the bake-time vision pass (bh-06). It reaches the Model seam (a
// vision-capable model call) AND drives headless Chrome (chromedp), so a live
// vision call on an award/heartbeat/expiry would be doubly catastrophic. It MUST
// stay off the hot path; the labModelPkgs check above enforces it, and
// TestVisionSeamIsReal below confirms the boundary is real.
const visionPkg = "swarmbuild/internal/harness/vision"

// livePkg is the bh-08 Live Build Mode adapter: the model-backed implementation of
// agent.LiveBuilder. It drives the refine loop on a LIVE model call in the Rover's
// work phase, so it reaches the Model seam and MUST stay off the self-heal core's
// import closure (the labModelPkgs check enforces it; TestLiveSeamIsReal confirms
// the boundary is real). The Rover reaches it only through the injected
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
	forbidden := append([]string{modelPkg}, labModelPkgs...)
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
						"Move the generation behind the offline bake/lab path.", pkg, bad)
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

// TestVisionSeamIsReal is the bh-06 meta-guard: it confirms the vision pass package
// genuinely pulls in BOTH the Model seam (a vision/model call) and chromedp (a
// headless browser), so the "vision off the hot path" assertion in
// TestModelSeamOffHotPath (via labModelPkgs) is guarding a real, network-and-browser
// boundary rather than a vacuous one.
func TestVisionSeamIsReal(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping vision arch self-check")
	}
	var foundModel, foundChrome bool
	for _, dep := range deps(t, visionPkg) {
		if dep == modelPkg {
			foundModel = true
		}
		if strings.Contains(dep, "chromedp/chromedp") {
			foundChrome = true
		}
	}
	if !foundModel {
		t.Fatalf("expected the vision pass %s to import the Model seam %s (so it is a real model boundary)", visionPkg, modelPkg)
	}
	if !foundChrome {
		t.Fatalf("expected the vision pass %s to import chromedp (so it is a real headless-browser boundary)", visionPkg)
	}
}

// TestLabSeamIsReal is the bh-07a meta-guard: it confirms the in-app live lab
// package genuinely pulls in the Model seam AND the refine loop, so the "lab off
// the hot path" assertion in TestModelSeamOffHotPath (via labModelPkgs) guards a
// real, network-capable boundary rather than a vacuous one.
func TestLabSeamIsReal(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping lab arch self-check")
	}
	var foundModel, foundLoop bool
	for _, dep := range deps(t, labPkg) {
		if dep == modelPkg {
			foundModel = true
		}
		if dep == "swarmbuild/internal/harness/loop" {
			foundLoop = true
		}
	}
	if !foundModel {
		t.Fatalf("expected the lab %s to import the Model seam %s (so it is a real model boundary)", labPkg, modelPkg)
	}
	if !foundLoop {
		t.Fatalf("expected the lab %s to import the refine loop (so it drives real generation)", labPkg)
	}
}

// TestLiveSeamIsReal is the bh-08 meta-guard: it confirms the Live Build Mode
// adapter genuinely pulls in the Model seam AND the refine loop, so the "live off
// the self-heal core" assertion in TestModelSeamOffHotPath (via labModelPkgs)
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
// or any model-wiring package (loop/bake/vision/lab/live) — that static cleanliness
// is precisely what keeps the coordinator (which imports the agent) off the model's
// import graph (TestModelSeamOffHotPath). A refactor that imports the model or the
// live adapter directly into the agent package fails here AND would cascade into the
// coordinator's hot-path check.
func TestAgentReachesModelOnlyViaInjectedSeam(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping agent-model arch test")
	}
	forbidden := append([]string{modelPkg, livePkg}, labModelPkgs...)
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

// TestGatewayDoesNotImportModelOrLab is the bh-07a boundary guard: the gateway
// hosts the live-lab SSE endpoint, but reaches the lab ONLY through an injected
// interface (gateway.LabRunner). So the gateway PACKAGE itself must NOT import the
// Model seam or the lab/loop — keeping the HTTP fan-out off the model's import
// graph and the live model call confined to the cmd/gateway composition root. A
// refactor that imports the lab directly into the gateway package fails here.
func TestGatewayDoesNotImportModelOrLab(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping gateway-model arch test")
	}
	const gatewayPkg = "swarmbuild/internal/gateway"
	forbidden := append([]string{modelPkg, labPkg}, labModelPkgs...)
	closure := make(map[string]bool)
	for _, dep := range deps(t, gatewayPkg) {
		closure[dep] = true
	}
	for _, bad := range forbidden {
		if closure[bad] {
			t.Fatalf("ARCH VIOLATION: gateway package %s imports %s — it must reach the live lab "+
				"ONLY through the injected gateway.LabRunner interface (bh-07a), keeping the gateway "+
				"off the model's import graph.", gatewayPkg, bad)
		}
	}
}

// TestHeadlinePathMakesZeroVisionCalls is the bh-06 acceptance guard: the headline
// replay path (the cache + the deterministic core that consults it) must NOT import
// the vision pass, so no award/heartbeat/expiry/tick or cache replay can ever
// trigger a headless render or a vision-model call. The cache package is the
// headline's only window onto baked specs; it carries DATA, never the vision seam.
func TestHeadlinePathMakesZeroVisionCalls(t *testing.T) {
	if !goAvailable() {
		t.Skip("go toolchain not on PATH; skipping headline-zero-vision arch test")
	}
	// The replay surface: the cache (consulted on the headline) plus every hot-path
	// package. None may pull in the vision pass.
	replayPkgs := append([]string{"swarmbuild/internal/harness/cache"}, hotPathPkgs...)
	for _, pkg := range replayPkgs {
		t.Run(pkg, func(t *testing.T) {
			for _, dep := range deps(t, pkg) {
				if dep == visionPkg {
					t.Fatalf("ARCH VIOLATION: headline/replay package %s imports the vision pass %s "+
						"(bh-06: the headline makes ZERO vision calls). Keep the vision pass on the bake/lab path only.", pkg, visionPkg)
				}
			}
		})
	}
}
