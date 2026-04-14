import { ingestConfig } from "../config/ingest-config";
import { embedText } from "./gemini";
import { loadIndex } from "./index-store";
import { cosineSimilarity } from "./math";
import type { ScoredChunk, SourceLanguage } from "../types";

type RankedChunk = ScoredChunk & {
  adjustedScore: number;
};

function sourceTrustWeight(chunk: { source: { type: "PDF" | "WEB"; title: string; fileName?: string } }): number {
  if (chunk.source.type !== "PDF") return 1;

  const label = `${chunk.source.title} ${chunk.source.fileName ?? ""}`.toLowerCase();
  const isRegulatoryPdf =
    /regolament|regulation|statut|code of ethics|guideline|disciplinar|procedure|normativa/.test(label);

  return isRegulatoryPdf ? 1.18 : 1.1;
}

function languageWeight(sourceLanguage: SourceLanguage, preferredLanguage: SourceLanguage): number {
  if (preferredLanguage === "unknown") return 1;
  if (sourceLanguage === preferredLanguage) return 1.14;
  if (sourceLanguage === "unknown") return 1;
  return 0.94;
}

function dedupeRanked(scored: RankedChunk[]): RankedChunk[] {
  const seen = new Set<string>();
  const deduped: RankedChunk[] = [];

  for (const item of scored) {
    const key = `${item.source.sourceId}:${item.fragment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function selectBalanced(results: RankedChunk[], topK: number): ScoredChunk[] {
  const pdf = results.filter((item) => item.source.type === "PDF");
  const web = results.filter((item) => item.source.type === "WEB");

  const targetWeb = Math.min(2, web.length, Math.floor(topK / 2));
  const targetPdf = Math.min(pdf.length, Math.max(topK - targetWeb, 0));

  const selected = new Map<string, RankedChunk>();

  for (const item of pdf.slice(0, targetPdf)) {
    selected.set(item.id, item);
  }
  for (const item of web.slice(0, targetWeb)) {
    selected.set(item.id, item);
  }

  if (selected.size < topK) {
    for (const item of results) {
      if (selected.size >= topK) break;
      selected.set(item.id, item);
    }
  }

  return Array.from(selected.values())
    .sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score)
    .slice(0, topK)
    .map((item) => ({
      id: item.id,
      text: item.text,
      fragment: item.fragment,
      embedding: item.embedding,
      source: item.source,
      score: item.score,
    }));
}

export async function retrieveRelevantChunks(
  question: string,
  topK = ingestConfig.topK,
  preferredLanguage: SourceLanguage = "it",
): Promise<ScoredChunk[]> {
  const index = await loadIndex();
  if (!index.chunks.length) return [];

  const questionEmbedding = await embedText(question);

  const scored: RankedChunk[] = index.chunks
    .map((chunk) => {
      const semanticScore = cosineSimilarity(questionEmbedding, chunk.embedding);
      return {
        ...chunk,
        score: semanticScore,
        adjustedScore:
          semanticScore * sourceTrustWeight(chunk) * languageWeight(chunk.source.language ?? "unknown", preferredLanguage),
      };
    })
    .filter((chunk) => chunk.score >= ingestConfig.minSimilarity)
    .sort((a, b) => b.adjustedScore - a.adjustedScore || b.score - a.score);

  const deduped = dedupeRanked(scored);
  return selectBalanced(deduped, topK);
}
