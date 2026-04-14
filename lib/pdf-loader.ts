import { promises as fs } from "node:fs";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { hashText } from "./hash";
import { cleanText } from "./text-utils";
import type { SourceLanguage } from "../types";

type LoadedPdfDocument = {
  sourceId: string;
  title: string;
  fileName: string;
  filePath: string;
  language: SourceLanguage;
  text: string;
};

const PDF_DIR = path.join(process.cwd(), "data", "pdfs");

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function inferLanguageFromRelativePath(relativePath: string): SourceLanguage {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  const [firstSegment] = normalized.split("/");

  if (firstSegment === "it") return "it";
  if (firstSegment === "en") return "en";

  return "unknown";
}

async function walkPdfFiles(directory: string, baseDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absoluteEntryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkPdfFiles(absoluteEntryPath, baseDirectory)));
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pdf")) {
      continue;
    }

    files.push(path.relative(baseDirectory, absoluteEntryPath));
  }

  return files;
}

export async function loadPdfDocuments(): Promise<LoadedPdfDocument[]> {
  await fs.mkdir(PDF_DIR, { recursive: true });
  await fs.mkdir(path.join(PDF_DIR, "it"), { recursive: true });
  await fs.mkdir(path.join(PDF_DIR, "en"), { recursive: true });

  const pdfFiles = await walkPdfFiles(PDF_DIR, PDF_DIR);
  const docs: LoadedPdfDocument[] = [];

  for (const relativePath of pdfFiles) {
    const normalizedRelativePath = normalizeRelativePath(relativePath);
    const absolutePath = path.join(PDF_DIR, relativePath);
    const buffer = await fs.readFile(absolutePath);
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    const text = cleanText(parsed.text);

    if (text.length < 120) continue;

    docs.push({
      sourceId: `pdf:${hashText(normalizedRelativePath)}`,
      title: path.basename(relativePath).replace(/\.pdf$/i, ""),
      fileName: path.basename(relativePath),
      filePath: normalizedRelativePath,
      language: inferLanguageFromRelativePath(normalizedRelativePath),
      text,
    });
  }

  return docs;
}
