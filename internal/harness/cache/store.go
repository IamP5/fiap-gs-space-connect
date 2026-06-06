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
