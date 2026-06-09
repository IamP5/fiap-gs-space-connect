package cache

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"strings"
	"sync"
)

//go:embed specs
var bakedFS embed.FS

const specsDir = "specs"

var (
	embeddedOnce  sync.Once
	embeddedCache *Cache
	errEmbedded   error
)

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
		if strings.HasSuffix(e.Name(), ".trace.json") {
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
