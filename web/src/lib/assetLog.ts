// assetLog.ts — one chokepoint that makes asset-pipeline failures VISIBLE.
//
// Every glTF/texture/HDR load in this app has an ADR-0004 fallback: a failed
// model keeps its primitive box, a failed texture keeps its flat colour, a
// failed .hdr drops IBL. That resilience means a failure never crashes the
// scene — but it also means failures are SILENT. Issue #171 was exactly this:
// a polish throw rejected the rover's glTF parse, the rejected promise was
// cached, every rover fell back to a primitive box, and an empty `.catch(()=>{})`
// printed nothing — so "the rover is a box" had no diagnosable cause.
//
// These helpers cost one console line per failure and turn every silent
// fallback into something a developer (or the user) can see and report. Keep
// the call sites — never swallow an asset failure without routing it here.
//
//   reportAssetError   — HARD fallback the user plainly sees (a model becomes a box)
//   reportAssetWarning — SOFT degrade (a texture flattens, IBL drops)
//
// `scope` is a short tag (e.g. "rover", "set-piece", "texture"); `detail` is
// usually the URL. The original error object is always forwarded as-is.

export function reportAssetError(scope: string, detail: string, err: unknown): void {
  console.error(`[asset] ${scope} failed → fallback: ${detail}`, err);
}

export function reportAssetWarning(scope: string, detail: string, err?: unknown): void {
  console.warn(`[asset] ${scope} degraded → fallback: ${detail}`, err);
}
