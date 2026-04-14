export const CHAT_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number];

export function isAllowedChatModel(value: string): value is ChatModelId {
  return (CHAT_MODELS as readonly string[]).includes(value);
}

