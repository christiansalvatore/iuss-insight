import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

import { generateGroundedAnswer } from "../../../lib/gemini";
import {
  detectPromptInjection,
  isQuestionValid,
  sanitizeModelAnswer,
  sanitizeQuestion,
} from "../../../lib/guardrails";
import { isAllowedChatModel, type ChatModelId } from "../../../lib/chat-models";
import { searchIussDomainWeb, shouldUseLiveWebSearch } from "../../../lib/live-web-search";
import { retrieveRelevantChunks } from "../../../lib/retrieval";
import { getWeeklyQuestionLimit, registerQuestionUsage } from "../../../lib/weekly-quota";
import { getAllowedEmailDomain, isAllowedInstitutionEmail } from "../../../lib/auth-policy";
import {
  INJECTION_REFUSAL_MESSAGE,
  INSUFFICIENT_INFO_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
} from "../../../lib/prompts";
import type { ChatResponse, SourceMeta } from "../../../types";

export const runtime = "nodejs";
type UiLanguage = "it" | "en";
type ChatTurn = { role: "user" | "assistant"; text: string };
type RawChatTurn = { role: string; text: string };
const MAX_HISTORY_TURNS = 8;
const MAX_HISTORY_TEXT_LENGTH = 450;
const MAX_DISPLAY_SOURCES = 4;
const RELATIVE_RELEVANCE_THRESHOLD = 0.72;
const MIN_ABSOLUTE_SOURCE_SCORE = 0.22;
const STOPWORDS = new Set([
  "il",
  "lo",
  "la",
  "i",
  "gli",
  "le",
  "un",
  "una",
  "di",
  "a",
  "da",
  "in",
  "con",
  "su",
  "per",
  "del",
  "della",
  "delle",
  "dello",
  "dei",
  "dove",
  "trovo",
  "link",
  "pagina",
  "sito",
  "please",
  "where",
  "find",
  "the",
  "and",
]);
const COURTESY_PATTERNS = [
  /^(grazie|grazie mille|ti ringrazio|perfetto|ok|va bene|tutto chiaro|chiaro|bene)[!. ]*$/i,
  /^(thanks|thank you|perfect|ok|got it|clear)[!. ]*$/i,
  /^(ciao|salve|buongiorno|buonasera|hello|hi)[!. ]*$/i,
];

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function isInsufficientAnswer(answer: string): boolean {
  const normalized = answer.toLowerCase();
  return (
    normalized.includes("non ho informazioni sufficienti") ||
    normalized.includes("i do not have enough information")
  );
}

function shouldUseHistoryForRetrieval(question: string): boolean {
  const normalized = question.trim().toLowerCase();
  if (!normalized) return false;

  const followUpHints =
    /(e invece|quello|quella|quelli|quelle|come sopra|stesso|stessa|approfondisci|piu dettagli|more details|that one|same one)/i;
  if (followUpHints.test(normalized)) return true;

  // Very short/elliptic questions benefit from previous turns.
  if (normalized.length <= 42) return true;

  // Full, explicit questions should not inherit previous-topic bias.
  return false;
}

function isCourtesyMessage(question: string): boolean {
  const normalized = question.trim();
  return COURTESY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function computeConfidence(
  topScore: number,
  sources: ChatResponse["sources"],
  answer: string,
): ChatResponse["confidence"] {
  const sourceTypes = new Set(sources.map((source) => source.type));
  const hasBothTypes = sourceTypes.has("PDF") && sourceTypes.has("WEB");
  const hasInsufficient = isInsufficientAnswer(answer);

  if (hasInsufficient) return "low";
  if (topScore >= 0.42 && sources.length >= 2 && (hasBothTypes || sources.length >= 3)) return "high";
  if (topScore >= 0.3 && sources.length >= 1) return "medium";
  return "low";
}

function salientTokens(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9à-öø-ÿ]+/i)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  );
}

function lexicalTokenHits(tokens: string[], text: string): number {
  if (!tokens.length) return 0;
  const normalized = text.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) hits += 1;
  }
  return hits;
}

function passesRelevanceGuard(input: {
  questionTokens: string[];
  score: number;
  title: string;
  url?: string;
  fileName?: string;
  fragment?: string;
  text: string;
}): boolean {
  const { questionTokens, score, title, url, fileName, fragment, text } = input;
  if (questionTokens.length === 0) return false;

  const compactText = text.slice(0, 1200);
  const haystack = `${title} ${url ?? ""} ${fileName ?? ""} ${fragment ?? ""} ${compactText}`;
  const hits = lexicalTokenHits(questionTokens, haystack);

  if (hits >= 2) return true;
  if (hits >= 1 && score >= 0.3) return true;
  if (score >= 0.48) return true;
  return false;
}

function relevanceToQuestion(
  source: Pick<ChatResponse["sources"][number], "title" | "url" | "fileName" | "fragment">,
  tokens: string[],
): number {
  const haystack = `${source.title} ${source.url ?? ""} ${source.fileName ?? ""} ${source.fragment ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function buildLocatorFallback(question: string, language: UiLanguage, sources: ChatResponse["sources"]): string | null {
  const asksForLocation = /(dove|link|pagina|url|sito|where|page|website|find)/i.test(question);
  if (!asksForLocation) return null;

  const tokens = salientTokens(question);
  const ranked = sources
    .map((source) => ({
      source,
      relevance: relevanceToQuestion(source, tokens),
    }))
    .filter((item) => item.relevance > 0 && item.source.href)
    .sort((a, b) => b.relevance - a.relevance)
    .map((item) => item.source)
    .slice(0, 3);

  if (ranked.length === 0) return null;

  if (language === "en") {
    return `I found relevant IUSS links you can open directly:\n${ranked
      .map((source) => `- ${source.title}: ${source.href}`)
      .join("\n")}`;
  }

  return `Ho trovato riferimenti IUSS pertinenti che puoi aprire direttamente:\n${ranked
    .map((source) => `- ${source.title}: ${source.href}`)
    .join("\n")}`;
}

function dedupeSourcesByDocument(
  entries: Array<{
    score: number;
    source: {
      title: string;
      type: "PDF" | "WEB";
      language: "it" | "en" | "unknown";
      url?: string;
      fileName?: string;
      filePath?: string;
      section?: string;
      fragment?: string;
      href?: string;
    };
  }>,
): Array<{
  score: number;
  source: {
    title: string;
    type: "PDF" | "WEB";
    language: "it" | "en" | "unknown";
    url?: string;
    fileName?: string;
    filePath?: string;
    section?: string;
    fragment?: string;
    href?: string;
  };
}> {
  const byDoc = new Map<
    string,
    {
      score: number;
      source: {
        title: string;
        type: "PDF" | "WEB";
        language: "it" | "en" | "unknown";
        url?: string;
        fileName?: string;
        filePath?: string;
        section?: string;
        fragment?: string;
        href?: string;
      };
    }
  >();

  for (const entry of entries) {
    const key = `${entry.source.type}:${entry.source.url ?? entry.source.fileName ?? entry.source.title}`;
    const existing = byDoc.get(key);
    if (!existing || entry.score > existing.score) {
      byDoc.set(key, entry);
    }
  }

  return Array.from(byDoc.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function selectSourcesForAnswer(
  question: string,
  ranked: Array<{
    score: number;
    source: {
      title: string;
      type: "PDF" | "WEB";
      language: "it" | "en" | "unknown";
      url?: string;
      fileName?: string;
      filePath?: string;
      section?: string;
      fragment?: string;
      href?: string;
    };
  }>,
): ChatResponse["sources"] {
  if (ranked.length === 0) return [];

  const asksForLocation = /(dove|link|pagina|url|sito|where|page|website|find)/i.test(question);
  const topScore = ranked[0].score || 0.0001;
  const minAcceptedScore = Math.max(topScore * RELATIVE_RELEVANCE_THRESHOLD, MIN_ABSOLUTE_SOURCE_SCORE);
  const selected = ranked.filter((item) => item.score >= minAcceptedScore).slice(0, MAX_DISPLAY_SOURCES);

  if (asksForLocation) {
    const bestWeb = ranked.find((item) => item.source.type === "WEB" && !!item.source.href);
    if (bestWeb) {
      const already = selected.some(
        (item) =>
          (item.source.url ?? item.source.fileName ?? item.source.title) ===
          (bestWeb.source.url ?? bestWeb.source.fileName ?? bestWeb.source.title),
      );
      if (!already && bestWeb.score >= topScore * 0.6) {
        if (selected.length < MAX_DISPLAY_SOURCES) {
          selected.push(bestWeb);
        } else {
          selected[selected.length - 1] = bestWeb;
        }
      }
    }
  }

  return selected.map((item, index) => ({
    citationId: `S${index + 1}`,
    relevance: Number((item.score / topScore).toFixed(3)),
    ...item.source,
  }));
}

function getMessages(language: UiLanguage) {
  if (language === "en") {
    return {
      invalidQuestion:
        "The question is invalid or too long. Please send a shorter and clearer question.",
      outOfScope:
        "I can only help with content and information derived from IUSS sources loaded in this application.",
      injection:
        "For security reasons, I can only answer informational questions about IUSS content and cannot follow instructions that alter chat rules.",
      insufficient:
        "I do not have enough information in the available sources to answer reliably.",
      authRequired: `Please sign in with an @${getAllowedEmailDomain()} account to use this chat.`,
      quotaExceeded: "Weekly question limit reached. Please try again next week.",
    };
  }

  return {
    invalidQuestion:
      "La domanda non e valida o supera la lunghezza consentita. Prova con una richiesta piu breve e specifica.",
    outOfScope: OUT_OF_SCOPE_MESSAGE,
    injection: INJECTION_REFUSAL_MESSAGE,
    insufficient: INSUFFICIENT_INFO_MESSAGE,
    authRequired: `Accedi con un account @${getAllowedEmailDomain()} per usare questa chat.`,
    quotaExceeded: "Hai raggiunto il limite settimanale di domande. Riprova la prossima settimana.",
  };
}

export async function POST(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });
    const sessionEmail = typeof token?.email === "string" ? token.email.toLowerCase() : "";
    if (!isAllowedInstitutionEmail(sessionEmail)) {
      return NextResponse.json({ error: getMessages("it").authRequired }, { status: 401 });
    }

    const body = await request.json();
    const rawQuestion = typeof body?.question === "string" ? body.question : "";
    const language: UiLanguage = body?.language === "en" ? "en" : "it";
    const requestedModel =
      typeof body?.chatModel === "string" && isAllowedChatModel(body.chatModel)
        ? (body.chatModel as ChatModelId)
        : undefined;
    const messages = getMessages(language);
    const question = sanitizeQuestion(rawQuestion);
    const history: ChatTurn[] = Array.isArray(body?.history)
      ? body.history
          .filter(
            (item: unknown): item is RawChatTurn =>
              !!item &&
              typeof item === "object" &&
              typeof (item as RawChatTurn).role === "string" &&
              typeof (item as RawChatTurn).text === "string",
          )
          .map((item: RawChatTurn) => ({
            role: item.role === "assistant" ? "assistant" : "user",
            text: sanitizeQuestion(item.text).slice(0, MAX_HISTORY_TEXT_LENGTH),
          }))
          .filter((item: ChatTurn) => item.text.length > 0)
          .slice(-MAX_HISTORY_TURNS)
      : [];

    if (!isQuestionValid(question)) {
      return badRequest(messages.invalidQuestion);
    }

    if (detectPromptInjection(question)) {
      const response: ChatResponse = {
        answer: messages.injection,
        sources: [],
        confidence: "low",
      };
      return NextResponse.json(response);
    }

    if (isCourtesyMessage(question)) {
      const response: ChatResponse = {
        answer: language === "en" ? "You're welcome." : "Prego.",
        sources: [],
        confidence: "low",
      };
      return NextResponse.json(response);
    }

    const questionTokens = salientTokens(question);
    if (questionTokens.length === 0) {
      const response: ChatResponse = {
        answer: messages.outOfScope,
        sources: [],
        confidence: "low",
      };
      return NextResponse.json(response);
    }

    const weeklyLimit = getWeeklyQuestionLimit();
    if (weeklyLimit > 0) {
      const quota = await registerQuestionUsage(sessionEmail, weeklyLimit);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            error: messages.quotaExceeded,
            limit: quota.limit,
            used: quota.current,
            week: quota.weekKey,
          },
          { status: 429 },
        );
      }
    }

    const recentUserContext = history
      .filter((item) => item.role === "user")
      .slice(-3)
      .map((item) => item.text)
      .join(" ");
    const useHistoryInRetrieval = shouldUseHistoryForRetrieval(question);
    const retrievalQuery = useHistoryInRetrieval
      ? [recentUserContext, question].filter(Boolean).join(" ")
      : question;
    const baseResults = await retrieveRelevantChunks(retrievalQuery, 6, language);
    const baseTypes = baseResults.map((item) => item.source.type);
    const liveWebResults = shouldUseLiveWebSearch(question, baseTypes)
      ? await searchIussDomainWeb(retrievalQuery, 3)
      : [];

    const mergedResults = [
      ...baseResults,
      ...liveWebResults.map((item) => ({
        id: `live-web:${item.url}`,
        text: item.text,
        fragment: item.fragment,
        embedding: [],
        source: {
          sourceId: `live-web:${item.url}`,
          title: item.title,
          type: "WEB" as const,
          language: "unknown" as const,
          url: item.url,
          fileName: undefined,
          filePath: undefined,
          section: undefined,
        } as SourceMeta,
        score: item.score,
      })),
    ];
    const relevantResults = mergedResults.filter((item) =>
      passesRelevanceGuard({
        questionTokens,
        score: item.score,
        title: item.source.title,
        url: item.source.url,
        fileName: item.source.fileName,
        fragment: item.fragment,
        text: item.text,
      }),
    );

    if (relevantResults.length === 0) {
      const response: ChatResponse = {
        answer: messages.outOfScope,
        sources: [],
        confidence: "low",
      };
      return NextResponse.json(response);
    }

    const topScore = Math.max(...relevantResults.map((item) => item.score));
    if (topScore < 0.24 && liveWebResults.length === 0) {
      const response: ChatResponse = {
        answer: messages.outOfScope,
        sources: [],
        confidence: "low",
      };
      return NextResponse.json(response);
    }

    const uniqueResults = Array.from(
      new Map(
        relevantResults.map((item) => [
          `${item.source.type}:${item.source.url ?? item.source.fileName ?? item.source.title}:${item.fragment ?? ""}`,
          item,
        ]),
      ).values(),
    );
    const rankedSources = dedupeSourcesByDocument(
      uniqueResults.map((item) => ({
        score: item.score,
        source: {
          title: item.source.title,
          type: item.source.type,
          language: item.source.language,
          url: item.source.url,
          fileName: item.source.fileName,
          filePath: item.source.filePath,
          section: item.source.section,
          fragment: item.fragment,
          href: item.source.url
            ? item.source.url
            : item.source.fileName
              ? `/api/pdf?file=${encodeURIComponent(item.source.filePath ?? item.source.fileName)}`
              : undefined,
        },
      })),
    );
    const sources = selectSourcesForAnswer(question, rankedSources);

    const contextBlocks = sources.map((source) => ({
      id: source.citationId,
      sourceLabel:
        source.type === "PDF"
          ? `${source.title} (PDF: ${source.fileName ?? "n/d"})`
          : `${source.title} (WEB: ${source.url ?? "n/d"})`,
      text:
        uniqueResults.find(
          (item) =>
            item.source.type === source.type &&
            (item.source.url ?? item.source.fileName ?? item.source.title) ===
              (source.url ?? source.fileName ?? source.title),
        )?.text ?? source.fragment ?? "",
    }));

    const rawAnswer = await generateGroundedAnswer({
      question,
      contextBlocks,
      language,
      conversationHistory: history,
      chatModel: requestedModel,
    });
    const answer = sanitizeModelAnswer(rawAnswer);
    const locatorFallback = buildLocatorFallback(question, language, sources);
    const shouldReplaceInsufficient = isInsufficientAnswer(answer);

    if (!answer || answer.length < 2) {
      const fallbackAnswer = locatorFallback ?? messages.insufficient;
      const responseSources = locatorFallback ? sources : [];
      const response: ChatResponse = {
        answer: fallbackAnswer,
        sources: responseSources,
        confidence: computeConfidence(topScore, responseSources, fallbackAnswer),
      };
      return NextResponse.json(response);
    }

    const finalAnswer = shouldReplaceInsufficient
      ? locatorFallback ?? messages.insufficient
      : answer;
    const responseSources = isInsufficientAnswer(finalAnswer) && !locatorFallback ? [] : sources;
    const response: ChatResponse = {
      answer: finalAnswer,
      sources: responseSources,
      confidence: computeConfidence(topScore, responseSources, finalAnswer),
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Errore interno. Verifica indice e configurazione delle variabili ambiente.";

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
