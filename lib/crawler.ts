import * as cheerio from "cheerio";

import type { CrawlConfig } from "../config/ingest-config";
import { hashText } from "./hash";
import { cleanText } from "./text-utils";
import type { SourceLanguage } from "../types";

type CrawledDocument = {
  sourceId: string;
  title: string;
  url: string;
  section?: string;
  language: SourceLanguage;
  text: string;
};

type QueueItem = {
  url: string;
  depth: number;
};

const EXCLUDED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".svg",
  ".pdf",
  ".zip",
  ".mp4",
  ".mp3",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
];

function canonicalize(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

function isAllowedPath(pathname: string, config: CrawlConfig): boolean {
  const normalized = pathname.toLowerCase();

  if (EXCLUDED_EXTENSIONS.some((ext) => normalized.endsWith(ext))) return false;
  if (config.excludePathPatterns.some((pattern) => normalized.includes(pattern.toLowerCase()))) {
    return false;
  }

  return config.allowPathPrefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
}

function getSeedUrls(config: CrawlConfig): string[] {
  return config.allowPathPrefixes.map((prefix) => new URL(prefix, config.domain).toString());
}

function inferLanguageFromUrl(url: string): SourceLanguage {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (pathname === "/en" || pathname.startsWith("/en/")) return "en";
    if (pathname === "/it" || pathname.startsWith("/it/")) return "it";
    return "unknown";
  } catch {
    return "unknown";
  }
}

function extractMainText(html: string): { text: string; title: string; section?: string } {
  const $ = cheerio.load(html);

  $(
    "script, style, nav, header, footer, aside, form, iframe, noscript, svg, [role='navigation'], .breadcrumb, .menu, .footer, .header",
  ).remove();

  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");

  const title = cleanText($("h1").first().text()) || cleanText($("title").first().text()) || "Pagina IUSS";
  const section = cleanText($("h2").first().text()) || undefined;
  const text = cleanText(root.text());

  return { text, title, section };
}

export async function crawlIussPages(config: CrawlConfig): Promise<CrawledDocument[]> {
  const queue: QueueItem[] = getSeedUrls(config).map((url) => ({ url: canonicalize(url), depth: 0 }));
  const seen = new Set<string>();
  const docs: CrawledDocument[] = [];

  while (queue.length > 0 && docs.length < config.maxPages) {
    const current = queue.shift();
    if (!current) break;

    const normalizedUrl = canonicalize(current.url);
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);

    const parsedUrl = new URL(normalizedUrl);
    if (parsedUrl.hostname !== new URL(config.domain).hostname) continue;
    if (!isAllowedPath(parsedUrl.pathname, config)) continue;

    try {
      const response = await fetch(normalizedUrl, {
        headers: {
          "User-Agent": "IUSS-Insight-Bot/1.0 (+https://www.iusspavia.it)",
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/html")) continue;

      const html = await response.text();
      const { text, title, section } = extractMainText(html);

      if (text.length >= config.minTextLength) {
        docs.push({
          sourceId: `web:${hashText(normalizedUrl)}`,
          title,
          url: normalizedUrl,
          section,
          language: inferLanguageFromUrl(normalizedUrl),
          text,
        });
      }

      if (current.depth >= config.maxDepth) continue;

      const $ = cheerio.load(html);
      $("a[href]").each((_, element) => {
        const href = $(element).attr("href");
        if (!href) return;

        try {
          const absolute = canonicalize(new URL(href, normalizedUrl).toString());
          const candidate = new URL(absolute);
          if (candidate.hostname !== new URL(config.domain).hostname) return;
          if (!isAllowedPath(candidate.pathname, config)) return;
          if (seen.has(absolute)) return;

          queue.push({ url: absolute, depth: current.depth + 1 });
        } catch {
          // Ignore malformed links.
        }
      });
    } catch {
      // Ignore network or parsing errors for robustness.
    }
  }

  return docs;
}
