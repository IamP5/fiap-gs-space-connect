package cache

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"swarmbuild/internal/harness/spec"
	"swarmbuild/internal/wire"
)

const DemoBlueprintID = "dome"

type Key struct {
	BlueprintID  string
	TaskID       string
	ContractHash string
	Model        string
}

type Entry struct {
	BlueprintID  string          `json:"blueprint_id"`
	TaskID       string          `json:"task_id"`
	TaskType     string          `json:"task_type"`
	ContractHash string          `json:"contract_hash"`
	Model        string          `json:"model"`
	Provider     string          `json:"provider,omitempty"`
	Ops          []wire.BuildOp  `json:"ops"`
	Repaired     bool            `json:"repaired"`
	Contract     json.RawMessage `json:"contract,omitempty"`
	QualityFlag  string          `json:"quality_flag,omitempty"`
}

func (e Entry) IsLowQuality() bool { return e.QualityFlag == "low" }

var filenameUnsafe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

func sanitize(s string) string {
	out := filenameUnsafe.ReplaceAllString(s, "-")
	out = strings.Trim(out, "-")
	if out == "" {
		return "none"
	}
	return out
}

func (k Key) Filename() string {
	return fmt.Sprintf("%s_%s_%s_%s.json",
		sanitize(k.BlueprintID),
		sanitize(k.TaskID),
		sanitize(k.ContractHash),
		sanitize(k.Model),
	)
}

func ContractHash(contract json.RawMessage) string {
	var v any
	if err := json.Unmarshal(contract, &v); err == nil {
		if compact, mErr := json.Marshal(v); mErr == nil {
			contract = compact
		}
	}
	sum := sha256.Sum256(contract)
	return hex.EncodeToString(sum[:])[:8]
}

func (e Entry) Validate() error {
	if e.BlueprintID == "" || e.TaskID == "" {
		return errors.New("cache entry missing blueprint_id/task_id")
	}
	if len(e.Ops) == 0 {
		return fmt.Errorf("cache entry %s/%s has zero ops", e.BlueprintID, e.TaskID)
	}
	return spec.Validate(e.Ops)
}

func (e Entry) Marshal() ([]byte, error) {
	return json.MarshalIndent(e, "", "  ")
}

func parseEntry(data []byte) (Entry, error) {
	var e Entry
	if err := json.Unmarshal(data, &e); err != nil {
		return Entry{}, fmt.Errorf("decode cache entry: %w", err)
	}
	if err := e.Validate(); err != nil {
		return Entry{}, fmt.Errorf("invalid cache entry: %w", err)
	}
	return e, nil
}

type taskKey struct{ blueprint, task string }

type index map[taskKey]Entry

func buildIndex(files map[string][]byte) (index, error) {
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)

	idx := make(index)
	for _, name := range names {
		e, err := parseEntry(files[name])
		if err != nil {
			return nil, fmt.Errorf("cache file %q: %w", name, err)
		}
		tk := taskKey{blueprint: e.BlueprintID, task: e.TaskID}
		if _, exists := idx[tk]; exists {
			continue
		}
		idx[tk] = e
	}
	return idx, nil
}

type Cache struct {
	idx index
}

func New(files map[string][]byte) (*Cache, error) {
	idx, err := buildIndex(files)
	if err != nil {
		return nil, err
	}
	return &Cache{idx: idx}, nil
}

func (c *Cache) Lookup(blueprintID, taskID string) (ops []wire.BuildOp, ok bool) {
	if c == nil {
		return nil, false
	}
	e, hit := c.idx[taskKey{blueprint: blueprintID, task: taskID}]
	if !hit {
		return nil, false
	}
	out := make([]wire.BuildOp, len(e.Ops))
	copy(out, e.Ops)
	return out, true
}

func (c *Cache) Len() int {
	if c == nil {
		return 0
	}
	return len(c.idx)
}
