package cache

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sync"
)

// bakedFS embeds the committed baked Build specs (the bake output, declarative
// geometry data). go:embed gives the headline a ZERO filesystem/network
// dependency: the binary carries the specs, so replay works in any container with
// no API key and no mounted cache dir (TECHSPEC §8). A directory with only the
// .gitkeep placeholder embeds cleanly and yields an empty cache (every Task then
// falls back to the primitive).
//
//go:embed specs
var bakedFS embed.FS

// specsDir is the embedded subdirectory the bake command writes committed specs
// into; it is also the on-disk path bake's Store targets, so embedded and
// freshly-baked caches stay in sync.
const specsDir = "specs"

var (
	embeddedOnce  sync.Once
	embeddedCache *Cache
	errEmbedded   error
)

// Embedded returns the process-wide replay Cache built from the committed,
// embedded baked specs. It is memoised: the index is parsed once on first use.
// Any malformed committed spec is a build-data error surfaced here (and caught by
// TestEmbeddedCache_Loads), never silently swallowed on the headline path.
func Embedded() (*Cache, error) {
	embeddedOnce.Do(func() {
		files, err := readEmbeddedFiles()
		if err != nil {
			errEmbedded = err
			return
		}
		embeddedCache, errEmbedded = New(files)
	})
	return embeddedCache, errEmbedded
}

// readEmbeddedFiles reads every *.json under the embedded specs dir into a
// filename → bytes map (the .gitkeep placeholder and any non-JSON file are
// skipped).
func readEmbeddedFiles() (map[string][]byte, error) {
	entries, err := bakedFS.ReadDir(specsDir)
	if err != nil {
		return nil, fmt.Errorf("read embedded specs dir: %w", err)
	}
	files := make(map[string][]byte)
	for _, e := range entries {
		if e.IsDir() || path.Ext(e.Name()) != ".json" {
			continue
		}
		b, rErr := fs.ReadFile(bakedFS, path.Join(specsDir, e.Name()))
		if rErr != nil {
			return nil, fmt.Errorf("read embedded spec %q: %w", e.Name(), rErr)
		}
		files[e.Name()] = b
	}
	return files, nil
}
