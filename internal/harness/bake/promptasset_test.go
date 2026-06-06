package bake

import (
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/wire"
	"testing"
)

// keyedContract builds a minimal valid Build contract scoped to the given Asset
// catalog, so the prompt-injection tests do not depend on DefaultCatalog() data.
func keyedContract(cat *asset.Catalog) Contract {
	return Contract{
		BlueprintID: "bp",
		TaskID:      "t1",
		Type:        typeFoundation,
		Envelope:    Envelope{Size: Vec3{X: 2, Y: 2, Z: 2}},
		Done:        Done{Description: "a foundation"},
		Catalog:     cat,
	}
}

// TestBuildPrompt_CarriesCatalogKeyList proves the assembled prompt offers the
// model the contract's Asset catalog by KEY (with each key's suited task type),
// instructs it that it may set asset_key, and — the load-bearing invariant
// (ADR-0010) — NEVER leaks a model_ref URL/path into the prompt. It injects its own
// catalog with known entries rather than relying on DefaultCatalog().
func TestBuildPrompt_CarriesCatalogKeyList(t *testing.T) {
	t.Parallel()
	cat := asset.NewCatalog(
		asset.NewEntry("test-foundation", "/assets/secret-foundation.glb",
			[]domain.TaskType{typeFoundation}, asset.Identity()),
		asset.NewEntry("test-wall", "/assets/secret-wall.glb",
			[]domain.TaskType{typeWall}, asset.Identity()),
	)
	c := keyedContract(cat)
	cj, err := c.JSON()
	if err != nil {
		t.Fatalf("contract JSON: %v", err)
	}
	msgs, err := BuildPrompt(c, cj, WorldContext{})
	if err != nil {
		t.Fatalf("BuildPrompt: %v", err)
	}

	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString("\n")
		sb.WriteString(m.Content)
	}
	all := sb.String()

	// The key list (names + suited types) is present.
	for _, want := range []string{"test-foundation", "test-wall", "asset_key", string(typeFoundation), string(typeWall)} {
		if !strings.Contains(all, want) {
			t.Fatalf("prompt missing %q\n---\n%s", want, all)
		}
	}

	// The resolved model_ref URLs/paths are NEVER in the prompt: the model picks a
	// key, the server resolves it before the browser ever sees a URL.
	for _, leak := range []string{
		"/assets/secret-foundation.glb", "/assets/secret-wall.glb",
		"secret-foundation.glb", "secret-wall.glb", ".glb",
	} {
		if strings.Contains(all, leak) {
			t.Fatalf("prompt leaked a resolved model_ref/URL %q\n---\n%s", leak, all)
		}
	}
}

// TestBuildPrompt_EmptyCatalogNoAssetOffer: a contract scoped to an EMPTY catalog
// adds no Asset offer to the prompt (the prompt stays purely procedural), so a Task
// with no curated Assets never sees a dangling "available keys" header.
func TestBuildPrompt_EmptyCatalogNoAssetOffer(t *testing.T) {
	t.Parallel()
	c := keyedContract(asset.NewCatalog())
	cj, err := c.JSON()
	if err != nil {
		t.Fatalf("contract JSON: %v", err)
	}
	msgs, err := BuildPrompt(c, cj, WorldContext{})
	if err != nil {
		t.Fatalf("BuildPrompt: %v", err)
	}
	for _, m := range msgs {
		if strings.Contains(m.Content, "CURATED ASSET CATALOG") || strings.Contains(m.Content, "asset_key") {
			t.Fatalf("empty catalog must add no Asset offer, got:\n%s", m.Content)
		}
	}
}

// TestResolveOp_InjectedCatalogClearsKey proves the live emit→resolve seam end to
// end on a SELF-INJECTED catalog (not DefaultCatalog): a place op carrying a valid
// in-catalog key resolves to shape=model + the self-hosted model_ref with the
// AssetKey CLEARED, and the entry's normalization transform composed onto the op's
// own pos/rot/scale (ADR-0010). This is the same ResolveSpec path the coordinator
// runs at publishSnapshot before the browser sees the op.
func TestResolveOp_InjectedCatalogClearsKey(t *testing.T) {
	t.Parallel()
	cat := asset.NewCatalog(
		asset.NewEntry("test-foundation", "/assets/secret-foundation.glb",
			[]domain.TaskType{typeFoundation},
			asset.Transform{
				Scale:  domain.Vec3{X: 2, Y: 2, Z: 2},
				Offset: domain.Vec3{X: 1, Y: 0, Z: 0},
			}),
	)
	op := wire.BuildOp{
		Op:       wire.BuildOpPlace,
		Shape:    wire.ShapeBox, // fallback shape on the keyed op
		Pos:      domain.Vec3{X: 5, Y: 1, Z: 1},
		Scale:    domain.Vec3{X: 3, Y: 3, Z: 3},
		Material: wire.Material{Color: "#ffffff"},
		AssetKey: "test-foundation",
	}
	got, ok := cat.ResolveOp(op)
	if !ok {
		t.Fatal("ResolveOp: want resolved for in-catalog key")
	}
	if got.AssetKey != "" {
		t.Fatalf("ResolveOp: asset_key must be cleared, got %q", got.AssetKey)
	}
	if got.Shape != wire.ShapeModel {
		t.Fatalf("ResolveOp: shape = %q, want %q", got.Shape, wire.ShapeModel)
	}
	if got.ModelRef != "/assets/secret-foundation.glb" {
		t.Fatalf("ResolveOp: model_ref = %q, want the self-hosted URL", got.ModelRef)
	}
	// Transform composes: scale multiplies (3*2=6), offset adds to pos (5+1=6).
	if got.Scale.X != 6 || got.Pos.X != 6 {
		t.Fatalf("ResolveOp: transform not composed: scale=%+v pos=%+v", got.Scale, got.Pos)
	}
}
