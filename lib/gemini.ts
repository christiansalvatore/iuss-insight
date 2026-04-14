import { GoogleGenerativeAI } from "@google/generative-ai";

import { getGeminiApiKey, getGeminiChatModel, getGeminiEmbedModel } from "./env";
import { buildAnswerPrompt, SYSTEM_PROMPT } from "./prompts";

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!client) {
    client = new GoogleGenerativeAI(getGeminiApiKey());
  }
  return client;
}

export async function embedText(text: string): Promise<number[]> {
  const model = getClient().getGenerativeModel({ model: getGeminiEmbedModel() });
  const result = await model.embedContent(text);
  const values = result.embedding?.values;

  if (!values || values.length === 0) {
    throw new Error("Embedding non disponibile dal modello Gemini.");
  }

  return values;
}

export async function generateGroundedAnswer(input: {
  question: string;
  contextBlocks: Array<{ id: string; sourceLabel: string; text: string }>;
  language?: "it" | "en";
  conversationHistory?: Array<{ role: "user" | "assistant"; text: string }>;
}): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: getGeminiChatModel(),
    systemInstruction: SYSTEM_PROMPT,
  });

  const prompt = buildAnswerPrompt(input);
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}
