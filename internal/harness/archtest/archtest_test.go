// Package archtest holds the import-graph architecture test that PROMOTES
// TECHSPEC §8's manual grep into an executable check (ADR-0005): it asserts the
// Model seam (internal/harness/model) is NOT in the import closure of the
// deterministic hot-path packages. A live model call wired onto an award, a
// heartbeat, or an expiry would pull the model package into one of those closures
// and fail this test in `go test` / CI.
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
	"swarmbuild/internal/harness/loop", // Generator↔Evaluator refine loop
	"swarmbuild/internal/harness/bake", // offline bake / bake-all (drives the loop)
}

// hotPathPkgs are the deterministic core packages on the live path of an award,
// a lease renewal/heartbeat, an expiry, and the single-writer tick (TECHSPEC §8,
// ADR-0005). None of them may import the Model seam, directly or transitively.
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
