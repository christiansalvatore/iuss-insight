import { promises as fs } from "node:fs";
import path from "node:path";

import type { IndexFile } from "../types";

const INDEX_PATH = path.join(process.cwd(), "data", "index", "iuss-index.json");

let cache: IndexFile | null = null;

function assertValidIndex(parsed: IndexFile): IndexFile {
  if (!Array.isArray(parsed.chunks)) {
    throw new Error("Indice non valido: formato chunks mancante.");
  }
  return parsed;
}

async function loadIndexFromBlob(): Promise<IndexFile> {
  const blobUrl = process.env.INDEX_BLOB_URL?.trim();
  if (!blobUrl) {
    throw new Error(
      "Indice non trovato in locale e INDEX_BLOB_URL non configurata. Carica l'indice su Vercel Blob.",
    );
  }

  const response = await fetch(blobUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Errore nel download indice da Blob: HTTP ${response.status}`);
  }

  const parsed = (await response.json()) as IndexFile;
  return assertValidIndex(parsed);
}

export async function loadIndex(): Promise<IndexFile> {
  if (cache) return cache;

  try {
    const raw = await fs.readFile(INDEX_PATH, "utf-8");
    const parsed = JSON.parse(raw) as IndexFile;
    cache = assertValidIndex(parsed);
    return cache;
  } catch (error) {
    const isFileMissing =
      error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
    if (!isFileMissing) {
      throw error;
    }
  }

  cache = await loadIndexFromBlob();
  return cache;
}

export function clearIndexCache() {
  cache = null;
}

export async function writeIndex(index: IndexFile): Promise<void> {
  await fs.mkdir(path.dirname(INDEX_PATH), { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(index, null, 2), "utf-8");
  cache = index;
}
