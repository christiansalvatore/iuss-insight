function readVar(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getGeminiApiKey(): string {
  const key = readVar("GEMINI_API_KEY") ?? readVar("GOOGLE_GENERATIVE_AI_API_KEY");
  if (!key) {
    throw new Error(
      "Variabile mancante: imposta GEMINI_API_KEY o GOOGLE_GENERATIVE_AI_API_KEY in ambiente server.",
    );
  }
  return key;
}

export function getGeminiChatModel(): string {
  return readVar("GEMINI_CHAT_MODEL") ?? "gemini-2.5-flash";
}

export function getGeminiEmbedModel(): string {
  return readVar("GEMINI_EMBED_MODEL") ?? "gemini-embedding-001";
}
