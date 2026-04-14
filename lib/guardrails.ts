const INJECTION_PATTERNS = [
  /ignore (all|any|previous|prior) instructions?/i,
  /disregard (all|any|previous|prior) instructions?/i,
  /system prompt/i,
  /developer message/i,
  /reveal .*prompt/i,
  /jailbreak/i,
  /bypass/i,
  /do not follow/i,
  /act as/i,
  /roleplay/i,
  /tool call/i,
  /function call/i,
];

export const MAX_QUESTION_LENGTH = 1200;

export function sanitizeQuestion(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 $2")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[<>{}[\]|^`~]/g, " ")
    .replace(/[!?.,;:]{4,}/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPromptInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

export function isQuestionValid(input: string): boolean {
  if (!input) return false;
  if (input.length > MAX_QUESTION_LENGTH) return false;

  const alnumCount = (input.match(/[a-zA-Z0-9À-ÖØ-öø-ÿ]/g) || []).length;
  return alnumCount >= 3;
}

export function sanitizeModelAnswer(answer: string): string {
  return answer
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+\n/g, "\n")
    .trim();
}
