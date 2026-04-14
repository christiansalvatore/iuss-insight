import { promises as fs } from "node:fs";
import path from "node:path";

import type { IndexFile } from "../types";

const INDEX_PATH = path.join(process.cwd(), "data", "index", "iuss-index.json");

let cache: IndexFile | null = null;

export async function loadIndex(): Promise<IndexFile> {
  if (cache) return cache;

  const raw = await fs.readFile(INDEX_PATH, "utf-8");
  const parsed = JSON.parse(raw) as IndexFile;

  if (!Array.isArray(parsed.chunks)) {
    throw new Error("Indice non valido: formato chunks mancante.");
  }

  cache = parsed;
  return parsed;
}

export function clearIndexCache() {
  cache = null;
}

export async function writeIndex(index: IndexFile): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
  cache = index;
}
