package bake

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// colorSilver is the brushed-metal pillar colour reused across the bake tests
// (hoisted to a const so goconst is satisfied).
const colorSilver = "#c0c0c0"

// idDomeCap is the dome-cap keystone task id, reused across the bake-all tests.
const idDomeCap = "dome-cap"

func readFile(t *testing.T, path string) ([]byte, error) {
	t.Helper()
	return os.ReadFile(path) //nolint:gosec // test-local path under t.TempDir()
}

// countSpecFiles counts cache SPEC files (*.json excluding *.trace.json) in dir.
func countSpecFiles(t *testing.T, dir string) int {
	t.Helper()
	return countMatching(t, dir, func(name string) bool {
		return filepath.Ext(name) == ".json" && !strings.HasSuffix(name, ".trace.json")
	})
}

// countTraceFiles counts trace sidecar files (*.trace.json) in dir.
func countTraceFiles(t *testing.T, dir string) int {
	t.Helper()
	return countMatching(t, dir, func(name string) bool {
		return strings.HasSuffix(name, ".trace.json")
	})
}

func countMatching(t *testing.T, dir string, match func(string) bool) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir %q: %v", dir, err)
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && match(e.Name()) {
			n++
		}
	}
	return n
}
