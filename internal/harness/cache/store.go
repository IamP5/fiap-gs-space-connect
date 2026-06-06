package cache

import (
	"fmt"
	"os"
	"path/filepath"
)

// Store is an on-disk cache directory the offline bake command writes baked specs
// into. It targets the package's committed specs dir by default
// (internal/harness/cache/specs) so a bake output is immediately committable and
// picked up by the embedded replay cache. It is NOT used on the headline path —
// only cmd/bake touches it.
type Store struct {
	dir string
}

// DefaultStoreDir returns the on-disk path of the package's committed specs
// directory relative to repoRoot (the directory containing go.mod). The bake
// command resolves repoRoot and passes it here so a `go run ./cmd/bake` from any
// CWD writes to the same committed location.
func DefaultStoreDir(repoRoot string) string {
	return filepath.Join(repoRoot, "internal", "harness", "cache", specsDir)
}

// NewStore opens (creating if needed) an on-disk cache directory.
func NewStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, fmt.Errorf("create cache dir %q: %w", dir, err)
	}
	return &Store{dir: dir}, nil
}

// Path returns the on-disk filename a key's entry is (or would be) written to.
func (s *Store) Path(k Key) string { return filepath.Join(s.dir, k.Filename()) }

// TracePath returns the on-disk filename of the lab-loop trace sidecar for a key:
// the spec filename with its ".json" suffix replaced by ".trace.json", so the
// trace sits beside the cached spec (ADR-0008). Stable for a given key.
func (k Key) TracePath() string {
	name := k.Filename()
	return name[:len(name)-len(".json")] + ".trace.json"
}

// WriteTrace persists the lab-loop trace sidecar bytes beside the cached spec for
// key, returning the file path it wrote. It does not validate the bytes (the trace
// is declarative audit data, not replayed). A re-bake overwrites the same file.
func (s *Store) WriteTrace(k Key, data []byte) (string, error) {
	if len(data) == 0 || data[len(data)-1] != '\n' {
		data = append(data, '\n') // trailing newline: clean diffs for the committed file
	}
	p := filepath.Join(s.dir, k.TracePath())
	if err := os.WriteFile(p, data, 0o600); err != nil {
		return "", fmt.Errorf("write trace file %q: %w", p, err)
	}
	return p, nil
}

// Write validates and persists an entry under its key, returning the file path it
// wrote. A re-bake of the same key overwrites the same file (the key filename is
// stable), so the cache never accumulates stale duplicates for one contract+model.
func (s *Store) Write(k Key, e Entry) (string, error) {
	if err := e.Validate(); err != nil {
		return "", fmt.Errorf("refusing to cache invalid entry: %w", err)
	}
	data, err := e.Marshal()
	if err != nil {
		return "", fmt.Errorf("marshal cache entry: %w", err)
	}
	data = append(data, '\n') // trailing newline: clean diffs for the committed file
	p := s.Path(k)
	if err := os.WriteFile(p, data, 0o600); err != nil {
		return "", fmt.Errorf("write cache file %q: %w", p, err)
	}
	return p, nil
}
