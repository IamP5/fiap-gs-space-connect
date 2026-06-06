// Package cache is the SwarmBuild Build-spec cache (TECHSPEC §4, ADR-0007): the
// on-disk, replayable store of generated Build specs that makes the deterministic
// headline possible. A spec is baked ONCE offline (cmd/bake) against a real model
// and committed to the repo as declarative geometry data — never a secret — so
// the live demo replays it byte-for-byte with NO model call and NO API key (the
// load-bearing "headline runs entirely from cache" invariant).
//
// A cache entry is keyed by {blueprintId, taskId, contractHash, model} so a
// changed Build contract or a different provider yields a fresh entry instead of
// silently replaying a stale one. Files are named from a sanitized key so the key
// is legible on disk and collision-free.
//
// This package is deliberately dependency-light (it imports only wire + the spec
// validator) and is reachable from the agent REPLAY path — it carries DATA, not a
// Model-seam call, so ADR-0005's hot-path invariant is preserved (the model
// package is never imported here). The committed cache is also exposed through an
// embedded filesystem (see embed.go) so the headline has zero filesystem dependency.
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

// DemoBlueprintID is the blueprint id the demo dome bakes and replays under. It
// is the blueprint half of every demo cache key and the value a demo Rover passes
// to the replay cache so a baked spec for this blueprint is found at headline time.
// It lives here (the dependency-light cache package) so both the demo wiring and
// the bake command can name it WITHOUT either pulling in the Model seam.
const DemoBlueprintID = "dome"

// Key identifies one cached Build spec (TECHSPEC §4). BlueprintID + TaskID locate
// the Task in a blueprint; ContractHash pins the exact Build contract the spec was
// generated for (a contract change ⇒ a new key); Model records the provider/model
// that produced it (a vendor swap ⇒ a new key).
type Key struct {
	BlueprintID  string
	TaskID       string
	ContractHash string
	Model        string
}

// Entry is the durable cache record: the approved, schema-valid ops plus the key
// fields and a short trace summary for auditability (ADR-0008's lightweight
// counterpart — the full lab trace is a separate file). It is committed to the
// repo verbatim.
type Entry struct {
	BlueprintID  string          `json:"blueprint_id"`
	TaskID       string          `json:"task_id"`
	TaskType     string          `json:"task_type"`
	ContractHash string          `json:"contract_hash"`
	Model        string          `json:"model"`
	Provider     string          `json:"provider,omitempty"`
	Ops          []wire.BuildOp  `json:"ops"`
	Repaired     bool            `json:"repaired"` // true if the spec needed the repair re-ask
	Contract     json.RawMessage `json:"contract,omitempty"`
	// QualityFlag is the advisory soft-quality marker (ADR-0008): "ok" when the
	// spec cleared the Evaluator's soft threshold, "low" when it passed the hard
	// gate but scored below it (cached, NOT withheld — the operator review lists
	// it). Empty on legacy entries is treated as "ok". It never affects replay:
	// the headline replays a flagged spec exactly like any other.
	QualityFlag string `json:"quality_flag,omitempty"`
}

// IsLowQuality reports whether this entry was flagged quality_flag:low (passed the
// hard gate but scored below the soft threshold). An empty flag is treated as ok.
func (e Entry) IsLowQuality() bool { return e.QualityFlag == "low" }

// filenameUnsafe matches every character we strip from key fields when forming a
// filename, so a model id like "gpt-4o-2024-08-06" or a slashed provider path
// becomes a safe, stable token.
var filenameUnsafe = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// sanitize folds a key field into a filename-safe token: non-[A-Za-z0-9._-] runs
// collapse to a single "-". Empty input becomes "none" so a missing field never
// produces an empty path segment.
func sanitize(s string) string {
	out := filenameUnsafe.ReplaceAllString(s, "-")
	out = strings.Trim(out, "-")
	if out == "" {
		return "none"
	}
	return out
}

// Filename is the on-disk name for this key: the four key fields joined by "_"
// (sanitized) with a .json suffix, e.g.
// "dome_foundation-1_a1b2c3d4_gpt-4o.json". Stable for a given key so a re-bake
// overwrites the same file.
func (k Key) Filename() string {
	return fmt.Sprintf("%s_%s_%s_%s.json",
		sanitize(k.BlueprintID),
		sanitize(k.TaskID),
		sanitize(k.ContractHash),
		sanitize(k.Model),
	)
}

// ContractHash is the canonical short hash of a Build contract: the SHA-256 of its
// compact JSON, truncated to 8 hex chars (enough to disambiguate contracts in a
// demo while keeping filenames short). It is stable across runs because the JSON
// is marshalled deterministically (Go sorts map keys), so re-baking an unchanged
// contract reuses the same key.
func ContractHash(contract json.RawMessage) string {
	// Re-encode through a generic value so semantically-equal contracts with
	// different key order or whitespace hash identically.
	var v any
	if err := json.Unmarshal(contract, &v); err == nil {
		if compact, mErr := json.Marshal(v); mErr == nil {
			contract = compact
		}
	}
	sum := sha256.Sum256(contract)
	return hex.EncodeToString(sum[:])[:8]
}

// Validate runs the same server-side gate (spec.Validate) over the entry's ops so
// a cache that survives to replay is guaranteed well-formed. It also requires the
// locating key fields to be present.
func (e Entry) Validate() error {
	if e.BlueprintID == "" || e.TaskID == "" {
		return errors.New("cache entry missing blueprint_id/task_id")
	}
	if len(e.Ops) == 0 {
		return fmt.Errorf("cache entry %s/%s has zero ops", e.BlueprintID, e.TaskID)
	}
	return spec.Validate(e.Ops)
}

// Marshal renders the entry as indented JSON for committing to the repo (stable,
// reviewable geometry data).
func (e Entry) Marshal() ([]byte, error) {
	return json.MarshalIndent(e, "", "  ")
}

// parseEntry decodes and validates a single cache file's bytes.
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

// taskKey is the (blueprint, task) index a replay lookup uses: the headline asks
// "is there a baked spec for this Task?" without knowing which contract-hash or
// model produced it.
type taskKey struct{ blueprint, task string }

// index maps each (blueprint, task) to its baked Entry. When more than one entry
// exists for a Task (e.g. several models baked), the lexicographically-first
// filename wins, so replay is DETERMINISTIC regardless of map iteration order.
type index map[taskKey]Entry

// buildIndex folds a set of (filename → bytes) cache files into a replay index,
// skipping any file that fails to parse/validate so one bad file never poisons
// the whole headline. files is iterated in sorted filename order so a deterministic
// entry wins on collision.
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
			continue // first (sorted) entry for a task wins: deterministic replay
		}
		idx[tk] = e
	}
	return idx, nil
}

// Cache is a read-only, in-memory replay index built from committed cache files.
// It is what the agent consults on the headline path: a hit yields the baked ops
// to replay, a miss yields ok=false so the caller uses the primitive fallback.
type Cache struct {
	idx index
}

// New builds a Cache from an in-memory set of cache files (filename → bytes). It
// is the dependency-free constructor the embedded loader and tests share. It
// returns an error if any file is malformed.
func New(files map[string][]byte) (*Cache, error) {
	idx, err := buildIndex(files)
	if err != nil {
		return nil, err
	}
	return &Cache{idx: idx}, nil
}

// Lookup returns the baked ops for (blueprintID, taskID) and ok=true on a hit, or
// ok=false on a miss (the caller then falls back to the primitive geometry —
// ADR-0005). The returned slice is a fresh copy so a caller can never mutate the
// cached entry.
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

// Len reports how many distinct (blueprint, task) specs the cache can replay.
func (c *Cache) Len() int {
	if c == nil {
		return 0
	}
	return len(c.idx)
}
