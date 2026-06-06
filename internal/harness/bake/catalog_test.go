package bake

import (
	"strings"
	"swarmbuild/internal/harness/asset"
	"testing"
)

// TestContractAssetCatalogFallback proves a contract that does not scope its own
// Asset catalog falls back to the global asset.DefaultCatalog() (ADR-0010: a
// default catalog backs contracts that don't specify one), and that a contract
// WITH a catalog keeps it.
func TestContractAssetCatalogFallback(t *testing.T) {
	t.Parallel()

	// No catalog set ⇒ the global default backs it (never nil), with curated keys.
	var c Contract
	got := c.AssetCatalog()
	if got == nil {
		t.Fatal("AssetCatalog() must never return nil")
	}
	if len(got.Keys()) == 0 {
		t.Fatal("default-backed catalog must carry curated keys")
	}

	// A contract-scoped catalog is returned verbatim.
	custom := asset.NewCatalog(asset.NewEntry("only", "/o.glb", nil, asset.Identity()))
	c.Catalog = custom
	if c.AssetCatalog() != custom {
		t.Fatal("AssetCatalog() must return the contract's own catalog when set")
	}
}

// TestContractCatalogExcludedFromJSON guards that the Asset catalog does NOT leak
// into the contract's canonical JSON (and so not into the cache key / ContractHash),
// so re-scoping available Assets never re-bakes geometry.
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
