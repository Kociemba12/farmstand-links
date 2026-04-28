/**
 * Farmstand Visibility Store
 *
 * Stores per-farmstand "show_on_map" overrides in a local JSON file.
 * This is a fallback for the Supabase `show_on_map` column which may not
 * yet exist in the schema. Once the column is added to Supabase, this file
 * will act as a confirmation cache and both paths will agree.
 *
 * File: /data/farmstand-visibility.json
 * Format: { "[farmstandId]": boolean, ... }
 * Absence of a key means the default (true = visible).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data");
const VISIBILITY_FILE = join(DATA_DIR, "farmstand-visibility.json");

export function readVisibilityMap(): Record<string, boolean> {
  try {
    if (!existsSync(VISIBILITY_FILE)) return {};
    const raw = readFileSync(VISIBILITY_FILE, "utf8");
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function setFarmstandVisibility(farmstandId: string, showOnMap: boolean): void {
  const map = readVisibilityMap();
  const previous = map[farmstandId];
  map[farmstandId] = showOnMap;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(VISIBILITY_FILE, JSON.stringify(map, null, 2));
  console.log(`[VisibilityStore] SET farmstand=${farmstandId} showOnMap=${showOnMap} (was ${previous ?? "unset/default"})`);
}
