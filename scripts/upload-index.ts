import path from "node:path";
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";

import { put } from "@vercel/blob";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

const INDEX_PATH = path.join(process.cwd(), "data", "index", "iuss-index.json");

async function main() {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) {
    throw new Error("Variabile mancante: BLOB_READ_WRITE_TOKEN.");
  }

  const body = await readFile(INDEX_PATH);
  console.log("[upload-index] Avvio upload indice su Vercel Blob (store privato)...");
  const result = await put("iuss-index.json", body, {
    access: "private",
    addRandomSuffix: false,
    token,
  });

  console.log(`[upload-index] Upload completato: ${result.url}`);
  console.log("[upload-index] Imposta INDEX_BLOB_URL con questo valore su Vercel.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Errore upload indice";
  console.error(`[upload-index] ${message}`);
  process.exit(1);
});
