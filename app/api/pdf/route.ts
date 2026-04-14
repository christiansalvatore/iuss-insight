import { promises as fs } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PDF_DIR = path.join(process.cwd(), "data", "pdfs");

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedFile = searchParams.get("file");

  if (!requestedFile) {
    return NextResponse.json({ error: "Parametro file mancante." }, { status: 400 });
  }

  const safeFileName = path.basename(requestedFile);
  if (!safeFileName.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "File non valido." }, { status: 400 });
  }

  const absolutePath = path.join(PDF_DIR, safeFileName);
  const normalizedBase = path.resolve(PDF_DIR);
  const normalizedFile = path.resolve(absolutePath);

  if (!normalizedFile.startsWith(normalizedBase)) {
    return NextResponse.json({ error: "Percorso non consentito." }, { status: 400 });
  }

  try {
    const data = await fs.readFile(normalizedFile);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(safeFileName)}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "PDF non trovato." }, { status: 404 });
  }
}

