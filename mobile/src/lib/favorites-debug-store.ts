// Stub — all debug emit calls have been removed from the source.
// This file exists only so Metro's module cache doesn't crash if it
// serves a stale bundle that still references emitFavoritesDebug.
// It will be unreferenced once Metro finishes re-bundling.
export function emitFavoritesDebug(_type: string, _payload?: unknown): void {
  // no-op
}
