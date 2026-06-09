package bake

import (
	"strings"
	"swarmbuild/internal/harness/asset"
	"testing"
)

func TestContractAssetCatalogFallback(t *testing.T) {
	t.Parallel()

	var c Contract
	got := c.AssetCatalog()
	if got == nil {
		t.Fatal("AssetCatalog() must never return nil")
	}
	if len(got.Keys()) == 0 {
		t.Fatal("default-backed catalog must carry curated keys")
	}

	custom := asset.NewCatalog(asset.NewEntry("only", "/o.glb", nil, asset.Identity()))
	c.Catalog = custom
	if c.AssetCatalog() != custom {
		t.Fatal("AssetCatalog() must return the contract's own catalog when set")
	}
}

func TestContractCatalogExcludedFromJSON(t *testing.T) {
	t.Parallel()
	c := Contract{
		TaskID:  "t1",
		Type:    "wall",
		Catalog: asset.NewCatalog(asset.NewEntry("k", "/k.glb", nil, asset.Identity())),
	}
	b, err := c.JSON()
	if err != nil {
		t.Fatalf("JSON: %v", err)
	}
	if strings.Contains(string(b), "catalog") || strings.Contains(string(b), "k.glb") {
		t.Fatalf("contract JSON must not carry the Asset catalog: %s", b)
	}
}
