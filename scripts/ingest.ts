import path from "node:path";
import { promises as fs } from "node:fs";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

import { crawlConfig, ingestConfig } from "../config/ingest-config";
import { embedText } from "../lib/gemini";
import { hashText } from "../lib/hash";
import { loadPdfDocuments } from "../lib/pdf-loader";
import { writeIndex } from "../lib/index-store";
import { chunkText, makeFragment } from "../lib/text-utils";
import { crawlIussPages } from "../lib/crawler";
import type { IndexFile, IndexedChunk, SourceMeta } from "../types";

const INDEX_FILE_PATH = path.join(process.cwd(), "data", "index", "iuss-index.json");
const EMBED_RETRY_ATTEMPTS = 6;
const PARTIAL_FLUSH_EVERY = 25;

function toSourceLabel(source: SourceMeta): string {
  return source.type === "PDF" ? `${source.title} [${source.fileName}]` : `${source.title} [${source.url}]`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTransientEmbeddingError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b/.test(message) || /service unavailable|timeout|temporar/i.test(message);
}

async function embedTextWithRetry(text: string): Promise<number[]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= EMBED_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await embedText(text);
    } catch (error) {
      lastError = error;
      if (!isTransientEmbeddingError(error) || attempt === EMBED_RETRY_ATTEMPTS) {
        throw error;
      }

      const baseDelay = 1200 * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * 400);
      const delay = Math.min(baseDelay + jitter, 20000);
      console.warn(`[ingest] Embedding retry ${attempt}/${EMBED_RETRY_ATTEMPTS} in ${delay}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

async function loadExistingEmbeddings(): Promise<Map<string, IndexedChunk>> {
  try {
    const raw = await fs.readFile(INDEX_FILE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as IndexFile;
    return new Map(parsed.chunks.map((chunk) => [chunk.id, chunk]));
  } catch {
    return new Map<string, IndexedChunk>();
  }
}

async function buildChunks(): Promise<Array<{ source: SourceMeta; text: string; fragment: string }>> {
  const pdfDocs = await loadPdfDocuments();
  const webDocs = await crawlIussPages(crawlConfig);

  const output: Array<{ source: SourceMeta; text: string; fragment: string }> = [];

  for (const doc of pdfDocs) {
    const source: SourceMeta = {
      sourceId: doc.sourceId,
      title: doc.title,
      type: "PDF",
      fileName: doc.fileName,
    };

    const chunks = chunkText(doc.text, ingestConfig.chunkSize, ingestConfig.chunkOverlap);
    for (const text of chunks) {
      output.push({
        source,
        text,
        fragment: makeFragment(text),
      });
    }
  }

  for (const doc of webDocs) {
    const source: SourceMeta = {
      sourceId: doc.sourceId,
      title: doc.title,
      type: "WEB",
      url: doc.url,
      section: doc.section,
    };

    const chunks = chunkText(doc.text, ingestConfig.chunkSize, ingestConfig.chunkOverlap);
    for (const text of chunks) {
      output.push({
        source,
        text,
        fragment: makeFragment(text),
      });
    }
  }

  return output;
}

async function main() {
  console.log("[ingest] Avvio pipeline...");

  const chunkCandidates = await buildChunks();
  console.log(`[ingest] Chunk grezzi: ${chunkCandidates.length}`);

  const unique: Array<{ source: SourceMeta; text: string; fragment: string }> = [];
  const seen = new Set<string>();

  for (const item of chunkCandidates) {
    const fingerprint = hashText(`${item.source.sourceId}:${item.text}`);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(item);
  }

  console.log(`[ingest] Chunk unici: ${unique.length}`);

  const existingEmbeddings = await loadExistingEmbeddings();
  console.log(`[ingest] Embedding gia presenti: ${existingEmbeddings.size}`);

  const chunks: IndexedChunk[] = [];
  let embeddedNow = 0;

  for (let i = 0; i < unique.length; i += 1) {
    const item = unique[i];
    const id = hashText(`${item.source.sourceId}:${item.text.slice(0, 280)}`);
    const cached = existingEmbeddings.get(id);

    if (cached && cached.text === item.text) {
      chunks.push({
        ...cached,
        source: item.source,
        fragment: item.fragment,
      });
    } else {
      const embedding = await embedTextWithRetry(item.text);
      chunks.push({
        id,
        text: item.text,
        fragment: item.fragment,
        embedding,
        source: item.source,
      });
      embeddedNow += 1;
    }

    if (chunks.length % PARTIAL_FLUSH_EVERY === 0 || i === unique.length - 1) {
      await writeIndex({
        generatedAt: new Date().toISOString(),
        chunkCount: chunks.length,
        chunks,
      });
      console.log(`[ingest] Embedding completati: ${chunks.length}/${unique.length}`);
    }
  }

  const index: IndexFile = {
    generatedAt: new Date().toISOString(),
    chunkCount: chunks.length,
    chunks,
  };

  await writeIndex(index);

  console.log(`[ingest] Completato. Chunk indicizzati: ${chunks.length}`);
  console.log(`[ingest] Nuovi embedding calcolati in questo run: ${embeddedNow}`);
  const labels = new Set(chunks.map((chunk) => toSourceLabel(chunk.source)));
  console.log(`[ingest] Fonti indicizzate: ${labels.size}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Errore sconosciuto";
  console.error(`[ingest] Errore: ${message}`);
  process.exit(1);
});
