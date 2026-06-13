
export function reportAssetError(scope: string, detail: string, err: unknown): void {
  console.error(`[asset] ${scope} failed → fallback: ${detail}`, err);
}

export function reportAssetWarning(scope: string, detail: string, err?: unknown): void {
  console.warn(`[asset] ${scope} degraded → fallback: ${detail}`, err);
}
