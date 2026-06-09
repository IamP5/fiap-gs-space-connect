package bake

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/harness/evaluator"
	"swarmbuild/internal/harness/model"
)

type Vec3 = domain.Vec3

type Envelope struct {
	Center Vec3 `json:"center"`
	Size   Vec3 `json:"size"`
}

type Done struct {
	Description string  `json:"description"`
	MinOps      int     `json:"min_ops,omitempty"`
	MinCoverage float64 `json:"min_coverage,omitempty"`
}

type Contract struct {
	BlueprintID string          `json:"blueprint_id"`
	TaskID      domain.TaskID   `json:"task_id"`
	Type        domain.TaskType `json:"type"`
	Envelope    Envelope        `json:"envelope"`
	Done        Done            `json:"done"`
	Style       string          `json:"style,omitempty"`
	Catalog     *asset.Catalog  `json:"-"`
}

func (c Contract) AssetCatalog() *asset.Catalog {
	if c.Catalog != nil {
		return c.Catalog
	}
	return asset.DefaultCatalog()
}

func (c Contract) JSON() (json.RawMessage, error) {
	b, err := json.Marshal(c)
	if err != nil {
		return nil, fmt.Errorf("marshal build contract: %w", err)
	}
	return b, nil
}

func (c Contract) EvalEnvelope() evaluator.Envelope {
	return evaluator.Envelope{Center: c.Envelope.Center, Size: c.Envelope.Size}
}

func (c Contract) EvalDone() evaluator.DoneCriteria {
	return evaluator.DoneCriteria{
		MinOps:      c.Done.MinOps,
		MinCoverage: c.Done.MinCoverage,
		Description: c.Done.Description,
	}
}

type WorldContext struct {
	TaskPos       domain.Vec2           `json:"task_pos"`
	Note          string                `json:"note,omitempty"`
	SubjectOrigin domain.Vec3           `json:"subject_origin"`
	Neighbours    []evaluator.Neighbour `json:"neighbours,omitempty"`
}

func BuildPrompt(c Contract, contractJSON json.RawMessage, world WorldContext) ([]model.Message, error) {
	worldJSON, err := json.Marshal(world)
	if err != nil {
		return nil, fmt.Errorf("marshal world context: %w", err)
	}

	system := "You are a SwarmBuild Build harness for a lunar-habitat construction swarm. " +
		"You emit DECLARATIVE geometry only — an ordered list of `place` ops (box | cylinder | sphere) " +
		"with pos/rot/scale (finite X,Y,Z; positive scale on every axis) and a PBR material " +
		"(non-empty hex color, optional roughness/metalness in [0,1]). " +
		"All coordinates are RELATIVE to the Task's Build-envelope frame and MUST stay within the envelope. " +
		"You never emit code; the renderer interprets your ops. Return strict JSON of the form {\"ops\": [ ... ]}." +
		assetCatalogNote(c)

	neighbourNote := ""
	if len(world.Neighbours) > 0 {
		neighbourNote = fmt.Sprintf(
			"\n\nNeighbouring structures already exist nearby (their accumulated ops are in the world "+
				"context above, in world coordinates). Do NOT overlap them; your geometry must abut or clear "+
				"them, never collide. There are %d neighbour task(s) near your envelope.",
			len(world.Neighbours),
		)
	}

	hx, hy, hz := c.Envelope.Size.X/2, c.Envelope.Size.Y/2, c.Envelope.Size.Z/2
	boundsNote := fmt.Sprintf(
		"\n\nHARD BOUNDS (envelope half-extents, centred on the origin): "+
			"X in [%.2f, %.2f], Y in [%.2f, %.2f], Z in [%.2f, %.2f]. "+
			"For EVERY op, pos.AXIS ± scale.AXIS/2 must lie within these limits — keep a ~10%% margin off each "+
			"wall. The base sits on the floor (lowest point near Y=%.2f); build upward from there.",
		-hx, hx, -hy, hy, -hz, hz, -hy,
	)

	user := fmt.Sprintf(
		"Build the geometry for this Task.\n\nBuild contract:\n%s\n\nWorld context:\n%s%s%s\n\n"+
			"Produce 3–8 ops that form a recognizable, structurally-plausible %s for a moon-base dome. "+
			"Keep every op strictly inside the HARD BOUNDS above; rise from the ground up.",
		string(contractJSON), string(worldJSON), neighbourNote, boundsNote, c.Type,
	)

	if c.TaskID == "" || c.Type == "" {
		return nil, errors.New("bake: contract must have a task_id and type")
	}

	return []model.Message{
		{Role: "system", Content: system},
		{Role: "user", Content: user},
	}, nil
}

func assetCatalogNote(c Contract) string {
	cat := c.AssetCatalog()
	keys := cat.Keys()
	if len(keys) == 0 {
		return ""
	}

	var b strings.Builder
	b.WriteString("\n\nCURATED ASSET CATALOG (ADR-0010): you MAY place a real, curated Asset instead of a " +
		"procedural shape by setting `asset_key` on a `place` op to one of the KEYS below (and you may still " +
		"set a fallback shape on the same op). NEVER invent a model_ref/URL/path — the server resolves the key " +
		"to a self-hosted model and fits it to your op's pos/rot/scale. Place an Asset only when its suited " +
		"type matches this Task; otherwise emit procedural shapes. Available keys (key — suited task type(s)):")
	for _, k := range keys {
		entry, ok := cat.Get(k)
		if !ok {
			continue
		}
		suited := "any task type"
		if len(entry.TaskTypes) > 0 {
			parts := make([]string, len(entry.TaskTypes))
			for i, t := range entry.TaskTypes {
				parts[i] = string(t)
			}
			suited = strings.Join(parts, ", ")
		}
		fmt.Fprintf(&b, "\n  - %s — %s", k, suited)
	}
	return b.String()
}
