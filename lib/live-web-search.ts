import * as cheerio from "cheerio";

import { cleanText, makeFragment } from "./text-utils";

type LiveWebResult = {
  title: string;
  url: string;
  text: string;
  fragment: string;
  score: number;
};

const SITEMAP_URLS = [
  "https://www.iusspavia.it/sitemap.xml",
  "https://iusspavia.it/sitemap.xml",
];

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

function canonicalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

function sameDomain(url: string): boolean {
  const hostname = new URL(url).hostname.toLowerCase();
  return hostname === "www.iusspavia.it" || hostname === "iusspavia.it";
}

function shouldSkipUrl(url: string): boolean {
  const pathname = new URL(url).pathname.toLowerCase();
  return EXCLUDED_EXTENSIONS.some((ext) => pathname.endsWith(ext));
}

function tokenize(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9à-öø-ÿ]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  );
}

function parseSitemapUrls(xml: string): string[] {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)];
  return matches.map((match) => match[1].trim()).filter(Boolean);
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "IUSS-Insight-Bot/1.0 (+https://www.iusspavia.it)",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

async function getDomainUrlsFromSitemap(): Promise<string[]> {
  for (const sitemapUrl of SITEMAP_URLS) {
    const rootXml = await fetchText(sitemapUrl);
    if (!rootXml) continue;

    const firstLevel = parseSitemapUrls(rootXml);
    const sitemapChildren = firstLevel.filter((url) => url.toLowerCase().endsWith(".xml")).slice(0, 10);
    const pageUrls = firstLevel.filter((url) => !url.toLowerCase().endsWith(".xml"));

    for (const childUrl of sitemapChildren) {
      const childXml = await fetchText(childUrl);
      if (!childXml) continue;
      pageUrls.push(...parseSitemapUrls(childXml));
    }

    return Array.from(
      new Set(
        pageUrls
          .map((url) => {
            try {
              return canonicalizeUrl(url);
            } catch {
              return "";
            }
          })
          .filter((url) => Boolean(url) && sameDomain(url) && !shouldSkipUrl(url)),
      ),
    );
  }

  return [];
}

function scoreUrl(url: string, tokens: string[]): number {
  const lower = url.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 2;
  }
  return score;
}

function extractMainText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $(
    "script, style, nav, header, footer, aside, form, iframe, noscript, svg, [role='navigation'], .breadcrumb, .menu, .footer, .header",
  ).remove();

  const title = cleanText($("h1").first().text()) || cleanText($("title").first().text()) || "Pagina IUSS";
  const root = $("main").first().length
    ? $("main").first()
    : $("article").first().length
      ? $("article").first()
      : $("body");
  const text = cleanText(root.text());
  return { title, text };
}

function scoreText(text: string, tokens: string[]): number {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) score += 3;
  }
  return score;
}

export async function searchIussDomainWeb(question: string, maxResults = 3): Promise<LiveWebResult[]> {
  const tokens = tokenize(question);
  if (tokens.length === 0) return [];

  const urls = await getDomainUrlsFromSitemap();
  if (!urls.length) return [];

  const candidateUrls = urls
    .map((url) => ({ url, score: scoreUrl(url, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 18)
    .map((item) => item.url);

  const results: LiveWebResult[] = [];

  for (const url of candidateUrls) {
    const html = await fetchText(url);
    if (!html) continue;
    const { title, text } = extractMainText(html);
    if (text.length < 250) continue;

    const textScore = scoreText(text, tokens);
    if (textScore <= 0) continue;

    results.push({
      title,
      url,
      text,
      fragment: makeFragment(text, 240),
      score: Math.min(0.55, 0.24 + textScore * 0.01),
    });
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

export function shouldUseLiveWebSearch(question: string, baseResultTypes: Array<"PDF" | "WEB">): boolean {
  const asksForLocation = /(dove|link|pagina|url|sito|where|page|website|find)/i.test(question);
  const onlyPdf = baseResultTypes.length > 0 && baseResultTypes.every((type) => type === "PDF");
  return asksForLocation || onlyPdf;
}

export type { LiveWebResult };
