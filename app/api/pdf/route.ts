import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PDF_DIR = path.join(process.cwd(), "data", "pdfs");

function normalizeRequestedFile(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isPathSafe(relativePath: string): boolean {
  if (!relativePath || !relativePath.toLowerCase().endsWith(".pdf")) return false;
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedFile = searchParams.get("file");

  if (!requestedFile) {
    return NextResponse.json({ error: "Parametro file mancante." }, { status: 400 });
  }

  const normalizedRequest = normalizeRequestedFile(requestedFile);
  if (!isPathSafe(normalizedRequest)) {
    return NextResponse.json({ error: "File non valido." }, { status: 400 });
  }

  const absolutePath = path.resolve(PDF_DIR, normalizedRequest);
  const normalizedBase = path.resolve(PDF_DIR);

  if (!absolutePath.startsWith(normalizedBase)) {
    return NextResponse.json({ error: "Percorso non consentito." }, { status: 400 });
  }

  try {
    const data = await fs.readFile(absolutePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(path.basename(normalizedRequest))}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF non trovato." }, { status: 404 });
  }
}
