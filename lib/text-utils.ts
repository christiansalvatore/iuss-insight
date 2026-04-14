export function cleanText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export function makeFragment(text: string, maxLength = 220): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function chunkText(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (paragraph.length > chunkSize) {
      const lines = paragraph.split(/(?<=[.!?])\s+/);
      for (const line of lines) {
        if ((current + " " + line).trim().length > chunkSize) {
          if (current.trim()) chunks.push(current.trim());
          current = current.slice(-overlap) + " " + line;
        } else {
          current = `${current} ${line}`.trim();
        }
      }
      continue;
    }

    if ((current + "\n\n" + paragraph).trim().length > chunkSize) {
      if (current.trim()) chunks.push(current.trim());
      current = `${current.slice(-overlap)} ${paragraph}`.trim();
    } else {
      current = `${current}\n\n${paragraph}`.trim();
    }
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks
    .map((chunk) => cleanText(chunk))
    .filter((chunk, index, arr) => chunk.length > 80 && arr.indexOf(chunk) === index);
}
