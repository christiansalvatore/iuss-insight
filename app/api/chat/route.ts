import { NextResponse } from "next/server";

import { generateGroundedAnswer } from "../../../lib/gemini";
import {
  detectPromptInjection,
  isQuestionValid,
  sanitizeModelAnswer,
  sanitizeQuestion,
} from "../../../lib/guardrails";
import { searchIussDomainWeb, shouldUseLiveWebSearch } from "../../../lib/live-web-search";
import { retrieveRelevantChunks } from "../../../lib/retrieval";
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

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function buildLocatorFallback(question: string, language: UiLanguage, sources: ChatResponse["sources"]): string | null {
  const asksForLocation = /(dove|link|pagina|url|sito|where|page|website|find)/i.test(question);
  if (!asksForLocation) return null;

  const webLinks = Array.from(
    new Set(
      sources
        .map((source) => source.url)
        .filter((url): url is string => typeof url === "string" && url.length > 0),
    ),
  ).slice(0, 3);
  if (webLinks.length === 0) return null;

  if (language === "en") {
    return `I found relevant IUSS pages that you can consult directly:\n${webLinks.map((url) => `- ${url}`).join("\n")}`;
  }

  return `Ho trovato pagine IUSS pertinenti che puoi consultare direttamente:\n${webLinks
    .map((url) => `- ${url}`)
    .join("\n")}`;
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
    };
  }

  return {
    invalidQuestion:
      "La domanda non e valida o supera la lunghezza consentita. Prova con una richiesta piu breve e specifica.",
    outOfScope: OUT_OF_SCOPE_MESSAGE,
    injection: INJECTION_REFUSAL_MESSAGE,
    insufficient: INSUFFICIENT_INFO_MESSAGE,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rawQuestion = typeof body?.question === "string" ? body.question : "";
    const language: UiLanguage = body?.language === "en" ? "en" : "it";
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
      };
      return NextResponse.json(response);
    }

    const recentUserContext = history
      .filter((item) => item.role === "user")
      .slice(-3)
      .map((item) => item.text)
      .join(" ");
    const retrievalQuery = [recentUserContext, question].filter(Boolean).join(" ");
    const baseResults = await retrieveRelevantChunks(retrievalQuery, 6);
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
          url: item.url,
          fileName: undefined,
          section: undefined,
        } as SourceMeta,
        score: item.score,
      })),
    ];

    if (mergedResults.length === 0) {
      const response: ChatResponse = {
        answer: messages.outOfScope,
        sources: [],
      };
      return NextResponse.json(response);
    }

    const topScore = Math.max(...mergedResults.map((item) => item.score));
    if (topScore < 0.24 && liveWebResults.length === 0) {
      const response: ChatResponse = {
        answer: messages.outOfScope,
        sources: [],
      };
      return NextResponse.json(response);
    }

    const uniqueResults = Array.from(
      new Map(
        mergedResults.map((item) => [
          `${item.source.type}:${item.source.url ?? item.source.fileName ?? item.source.title}:${item.fragment ?? ""}`,
          item,
        ]),
      ).values(),
    );

    const contextBlocks = uniqueResults.map((item, index) => ({
      id: `S${index + 1}`,
      sourceLabel:
        item.source.type === "PDF"
          ? `${item.source.title} (PDF: ${item.source.fileName ?? "n/d"})`
          : `${item.source.title} (WEB: ${item.source.url ?? "n/d"})`,
      text: item.text,
    }));

    const sources = uniqueResults.map((item, index) => ({
      citationId: `S${index + 1}`,
      title: item.source.title,
      type: item.source.type,
      url: item.source.url,
      fileName: item.source.fileName,
      section: item.source.section,
      fragment: item.fragment,
      href: item.source.url
        ? item.source.url
        : item.source.fileName
          ? `/api/pdf?file=${encodeURIComponent(item.source.fileName)}`
          : undefined,
    }));

    const rawAnswer = await generateGroundedAnswer({
      question,
      contextBlocks,
      language,
      conversationHistory: history,
    });
    const answer = sanitizeModelAnswer(rawAnswer);
    const locatorFallback = buildLocatorFallback(question, language, sources);
    const shouldReplaceInsufficient =
      answer.toLowerCase().includes("non ho informazioni sufficienti") ||
      answer.toLowerCase().includes("i do not have enough information");

    if (!answer || answer.length < 2) {
      const response: ChatResponse = {
        answer: locatorFallback ?? messages.insufficient,
        sources,
      };
      return NextResponse.json(response);
    }

    const response: ChatResponse = {
      answer: shouldReplaceInsufficient && locatorFallback ? locatorFallback : answer,
      sources,
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
