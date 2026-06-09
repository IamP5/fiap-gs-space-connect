package bake

import (
	"strings"
	"swarmbuild/internal/core/domain"
	"swarmbuild/internal/harness/asset"
	"swarmbuild/internal/wire"
	"testing"
)

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

	for _, want := range []string{"test-foundation", "test-wall", "asset_key", string(typeFoundation), string(typeWall)} {
		if !strings.Contains(all, want) {
			t.Fatalf("prompt missing %q\n---\n%s", want, all)
		}
	}

	for _, leak := range []string{
		"/assets/secret-foundation.glb", "/assets/secret-wall.glb",
		"secret-foundation.glb", "secret-wall.glb", ".glb",
	} {
		if strings.Contains(all, leak) {
			t.Fatalf("prompt leaked a resolved model_ref/URL %q\n---\n%s", leak, all)
		}
	}
}

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
		Shape:    wire.ShapeBox,
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
	if got.Scale.X != 6 || got.Pos.X != 6 {
		t.Fatalf("ResolveOp: transform not composed: scale=%+v pos=%+v", got.Scale, got.Pos)
	}
}
