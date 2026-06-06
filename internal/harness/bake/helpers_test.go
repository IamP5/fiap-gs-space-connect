package bake

import (
	"os"
	"path/filepath"
	"testing"
)

func readFile(t *testing.T, path string) ([]byte, error) {
	t.Helper()
	return os.ReadFile(path) //nolint:gosec // test-local path under t.TempDir()
}

func countFiles(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("readdir %q: %v", dir, err)
	}
	n := 0
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".json" {
			n++
		}
	}
	return n
}
