export type SourceType = "PDF" | "WEB";

export type SourceMeta = {
  sourceId: string;
  title: string;
  type: SourceType;
  url?: string;
  fileName?: string;
  section?: string;
};

export type IndexedChunk = {
  id: string;
  text: string;
  fragment: string;
  embedding: number[];
  source: SourceMeta;
};

export type IndexFile = {
  generatedAt: string;
  chunkCount: number;
  chunks: IndexedChunk[];
};

export type ScoredChunk = IndexedChunk & {
  score: number;
};

export type ChatSource = {
  citationId: string;
  title: string;
  type: SourceType;
  url?: string;
  fileName?: string;
  section?: string;
  fragment?: string;
  href?: string;
};

export type ChatResponse = {
  answer: string;
  sources: ChatSource[];
};
