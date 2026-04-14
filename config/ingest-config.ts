import crawlAllowlist from "./crawl-allowlist.json";

export type CrawlConfig = {
  domain: string;
  allowPathPrefixes: string[];
  excludePathPatterns: string[];
  maxPages: number;
  maxDepth: number;
  minTextLength: number;
};

export const crawlConfig: CrawlConfig = crawlAllowlist;

export const ingestConfig = {
  chunkSize: 1100,
  chunkOverlap: 180,
  topK: 6,
  minSimilarity: 0.2,
};
