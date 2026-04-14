"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRef } from "react";

import type { ChatResponse } from "../types";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  sources?: ChatResponse["sources"];
};

type UiLanguage = "it" | "en";
type ThemeMode = "light" | "dark";

const I18N: Record<
  UiLanguage,
  {
    title: string;
    subtitle: string;
    placeholder: string;
    send: string;
    sending: string;
    clear: string;
    sources: string;
    emptyState: string;
    noSources: string;
    type: string;
    url: string;
    file: string;
    section: string;
    fragment: string;
    disclaimer: string;
    examples: string[];
  }
> = {
  it: {
    title: "IUSS Insight",
    subtitle: "Chat istituzionale su fonti IUSS (PDF e pagine iusspavia.it in allowlist).",
    placeholder: "Scrivi una domanda sui contenuti IUSS...",
    send: "Invia",
    sending: "Invio...",
    clear: "Svuota",
    sources: "Fonti consultate",
    emptyState: "Inserisci una domanda per iniziare. La chat usa esclusivamente le fonti IUSS indicizzate.",
    noSources: "Nessuna fonte pertinente recuperata.",
    type: "Tipo",
    url: "URL",
    file: "File",
    section: "Sezione",
    fragment: "Frammento",
    disclaimer:
      "IUSS Insight puo commettere errori. Per conferme ufficiali e casi specifici, contatta sempre gli uffici IUSS competenti.",
    examples: [
      "Quali sono i requisiti di accesso ai Corsi ordinari IUSS?",
      "Dove trovo informazioni sulla Scuola di dottorato?",
      "Quali documenti servono per le procedure di ammissione?",
      "Come contattare le segreterie per gli allievi?",
    ],
  },
  en: {
    title: "IUSS Insight",
    subtitle: "Institutional chat based on IUSS sources (PDFs and allowlisted iusspavia.it pages).",
    placeholder: "Ask a question about IUSS content...",
    send: "Send",
    sending: "Sending...",
    clear: "Clear",
    sources: "Consulted Sources",
    emptyState: "Ask a question to start. The chat uses only indexed IUSS sources.",
    noSources: "No relevant sources were retrieved.",
    type: "Type",
    url: "URL",
    file: "File",
    section: "Section",
    fragment: "Excerpt",
    disclaimer:
      "IUSS Insight can make mistakes. For official confirmation and specific cases, always contact the relevant IUSS offices.",
    examples: [
      "What are the admission requirements for IUSS Ordinary Courses?",
      "Where can I find information about the Doctoral School?",
      "Which documents are required for admission procedures?",
      "How can students contact administrative offices?",
    ],
  },
};

function renderAnswerWithCitations(text: string, sources: ChatResponse["sources"] = []) {
  const byCitation = new Map(sources.map((source) => [source.citationId, source]));
  const chunks = text.split(/(\[S\d+\])/g);

  return chunks.map((chunk, index) => {
    const match = chunk.match(/^\[(S\d+)\]$/);
    if (!match) return <span key={`txt-${index}`}>{chunk}</span>;

    const citationId = match[1];
    const source = byCitation.get(citationId);
    if (!source) return <span key={`cit-${index}`}>{chunk}</span>;

    const href = source.href || `#source-${citationId}`;
    return (
      <a
        key={`cit-${index}`}
        href={href}
        target={source.href ? "_blank" : undefined}
        rel={source.href ? "noopener noreferrer" : undefined}
        className="rounded-md bg-[var(--tag-bg)] px-1.5 py-0.5 text-[var(--tag-text)] underline"
      >
        [{citationId}]
      </a>
    );
  });
}

export function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<UiLanguage>("it");
  const [theme, setTheme] = useState<ThemeMode>("light");
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (!messagesContainerRef.current) return;
    messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
  }, [messages, loading]);

  const copy = I18N[language];
  const canSend = useMemo(() => question.trim().length > 0 && !loading, [question, loading]);

  const submit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setError(null);
    setLoading(true);
    setQuestion("");
    const historyPayload = messages.slice(-8).map((message) => ({
      role: message.role,
      text: message.text,
    }));

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed, language, history: historyPayload }),
      });

      const payload = (await response.json()) as ChatResponse & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Request failed.");
      }

      setMessages((prev) => [...prev, { role: "assistant", text: payload.answer, sources: payload.sources }]);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-4 py-6 sm:px-6 lg:py-10">
      <section className="glass-panel overflow-hidden rounded-3xl border border-[var(--line)]">
        <header className="border-b border-[var(--line)] px-5 py-5 sm:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-[var(--accent)] sm:text-3xl">{copy.title}</h1>
              <p className="mt-1 text-sm text-[var(--muted)] sm:text-base">{copy.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLanguage("it")}
                className="toggle-btn"
                aria-pressed={language === "it"}
                title="Italiano"
              >
                🇮🇹 IT
              </button>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className="toggle-btn"
                aria-pressed={language === "en"}
                title="English"
              >
                🇬🇧 EN
              </button>
              <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")} className="toggle-btn">
                {theme === "light" ? "Dark" : "Light"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {copy.examples.map((example) => (
              <button key={example} type="button" onClick={() => setQuestion(example)} className="chip-btn">
                {example}
              </button>
            ))}
          </div>
        </header>

        <div ref={messagesContainerRef} className="h-[54vh] overflow-y-auto px-5 py-5 sm:px-8">
          {messages.length === 0 ? (
            <p className="text-sm text-[var(--muted)] sm:text-base">{copy.emptyState}</p>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => (
                <article key={`${message.role}-${index}`} className="space-y-2">
                  <div className={`bubble ${message.role === "user" ? "bubble-user" : "bubble-assistant"}`}>
                    {message.role === "assistant" ? renderAnswerWithCitations(message.text, message.sources) : message.text}
                  </div>

                  {message.role === "assistant" && (
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-soft)] p-3 text-xs sm:text-sm">
                      <p className="font-semibold text-[var(--accent)]">{copy.sources}</p>
                      {message.sources && message.sources.length > 0 ? (
                        <ul className="mt-2 space-y-2 text-[var(--muted)]">
                          {message.sources.map((source, sourceIndex) => (
                            <li key={`${source.citationId}-${sourceIndex}`} id={`source-${source.citationId}`}>
                              <p className="font-medium text-[var(--text)]">
                                [{source.citationId}] {source.title}
                              </p>
                              <p>
                                {copy.type}: {source.type} |{" "}
                                {source.href ? (
                                  <a
                                    href={source.href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline text-[var(--accent)]"
                                  >
                                    {source.url ? `${copy.url}: ${source.url}` : `${copy.file}: ${source.fileName ?? "n/a"}`}
                                  </a>
                                ) : source.url ? (
                                  `${copy.url}: ${source.url}`
                                ) : (
                                  `${copy.file}: ${source.fileName ?? "n/a"}`
                                )}
                              </p>
                              {source.section ? <p>{copy.section}: {source.section}</p> : null}
                              {source.fragment ? <p>{copy.fragment}: {source.fragment}</p> : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-[var(--muted)]">{copy.noSources}</p>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-[var(--line)] px-5 py-4 sm:px-8">
          <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.placeholder}
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-sm text-[var(--text)] outline-none ring-[var(--accent)] focus:ring sm:text-base"
            />
            <div className="flex gap-2">
              <button type="submit" disabled={!canSend} className="action-btn-primary">
                {loading ? copy.sending : copy.send}
              </button>
              <button type="button" onClick={clearChat} className="action-btn-secondary">
                {copy.clear}
              </button>
            </div>
          </form>
          {error ? <p className="mt-2 text-sm text-[#b42318]">{error}</p> : null}
          <p className="mt-3 text-xs text-[var(--muted)] sm:text-sm">{copy.disclaimer}</p>
        </footer>
      </section>
    </main>
  );
}
