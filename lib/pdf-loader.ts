import { promises as fs } from "node:fs";
import path from "node:path";

import { PDFParse } from "pdf-parse";

import { hashText } from "./hash";
import { cleanText } from "./text-utils";

type LoadedPdfDocument = {
  sourceId: string;
  title: string;
  fileName: string;
  text: string;
};

const PDF_DIR = path.join(process.cwd(), "data", "pdfs");

export async function loadPdfDocuments(): Promise<LoadedPdfDocument[]> {
  await fs.mkdir(PDF_DIR, { recursive: true });
  const files = await fs.readdir(PDF_DIR);

  const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"));
  const docs: LoadedPdfDocument[] = [];

  for (const fileName of pdfFiles) {
    const absolutePath = path.join(PDF_DIR, fileName);
    const buffer = await fs.readFile(absolutePath);
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    const text = cleanText(parsed.text);

    if (text.length < 120) continue;

    docs.push({
      sourceId: `pdf:${hashText(fileName)}`,
      title: fileName.replace(/\.pdf$/i, ""),
      fileName,
      text,
    });
  }

  return docs;
}
