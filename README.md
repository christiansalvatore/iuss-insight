# IUSS Insight

Chat minimale, moderna e deployabile su Vercel, limitata ai contenuti istituzionali/accademici IUSS Pavia provenienti da:
- PDF locali in `data/pdfs/it` e `data/pdfs/en`
- pagine pubbliche `iusspavia.it` filtrate da allowlist

## Architettura scelta (pragmatica)
Soluzione: **RAG semantico leggero con indice JSON locale**.

Perche:
- semplice da mantenere (nessun DB/vector store esterno)
- deploy facile su Vercel
- aggiornamento fonti lineare (`npm run ingest`)
- retrieval controllabile con metadati + soglie
- evita overengineering nella prima versione

Flusso:
1. `scripts/ingest.ts` legge PDF + crawl pagine allowlist.
2. Pulizia HTML, chunking testo, deduplica.
3. Embedding Gemini per ogni chunk.
4. Salvataggio indice in `data/index/iuss-index.json`.
5. `POST /api/chat` fa embedding domanda, retrieval top-k, risposta Gemini vincolata al contesto.

## Requisiti
- Node.js 20+
- npm
- API key Gemini

## Installazione
```bash
npm install
```

## Variabili ambiente
Copia `.env.example` in `.env.local`:
```bash
cp .env.example .env.local
```

Compila i valori:
- `GEMINI_API_KEY` oppure `GOOGLE_GENERATIVE_AI_API_KEY` (almeno una obbligatoria)
- `APP_URL` (es. `http://localhost:3000` in locale)
- `NEXTAUTH_URL` (es. `http://localhost:3000` in locale, URL Vercel in produzione)
- `NEXTAUTH_SECRET` (stringa casuale lunga)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BLOB_READ_WRITE_TOKEN` (necessario per upload e lettura indice da store Blob privato)
- `INDEX_BLOB_URL` (URL dell'indice su Vercel Blob; usato in produzione quando il file locale non e presente)
- `WEEKLY_QUESTION_LIMIT` (numero massimo domande per utente a settimana, es. `100`; `0` o vuoto disabilita limite)
- `UPSTASH_REDIS_REST_URL` (obbligatoria se `WEEKLY_QUESTION_LIMIT > 0`)
- `UPSTASH_REDIS_REST_TOKEN` (obbligatoria se `WEEKLY_QUESTION_LIMIT > 0`)
- opzionali: `GEMINI_CHAT_MODEL`, `GEMINI_EMBED_MODEL`

### Login Google (solo dominio IUSS)
L'app usa autenticazione Google con `next-auth` e accetta solo account `@iusspavia.it`.

Configura OAuth su Google Cloud:
1. Crea credenziali OAuth 2.0 (Web application).
2. Authorized redirect URIs in locale: `http://localhost:3000/api/auth/callback/google`
3. Authorized redirect URIs in produzione: `https://<tuo-dominio>/api/auth/callback/google`
4. Copia `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` nelle env.

## Inserire i PDF
Metti i PDF in:
- `data/pdfs/it` per i documenti in italiano
- `data/pdfs/en` per i documenti in inglese

Nota: il loader legge in modo ricorsivo anche eventuali sottocartelle aggiuntive sotto `data/pdfs`.

## Configurare crawling sito
Modifica `config/crawl-allowlist.json`:
- `allowPathPrefixes`: sezioni ammesse
- `excludePathPatterns`: percorsi da evitare
- `maxPages`, `maxDepth`, `minTextLength`

Crawler prudente:
- dominio limitato a `iusspavia.it`
- evita allegati/media e URL fuori allowlist
- limita profondita e numero pagine

## Ingestione / rebuild indice
```bash
npm run ingest
```

Priorita lingua nel retrieval:
- preferenza alla lingua della chat (`it` di default)
- fallback automatico ai documenti inglesi se utili

Output:
- `data/index/iuss-index.json`

Esegui di nuovo ingestione quando:
- aggiungi/modifichi PDF
- cambiano pagine IUSS rilevanti
- aggiorni allowlist

## Upload indice su Vercel Blob (consigliato per produzione)
Se `data/index/iuss-index.json` e troppo grande per GitHub:
1. Genera l'indice in locale con `npm run ingest`
2. Caricalo su Blob:
```bash
npm run upload:index
```
3. Prendi l'URL stampato e impostalo in Vercel come `INDEX_BLOB_URL`
4. Deploy/redeploy

Fallback runtime:
- in locale l'app legge `data/index/iuss-index.json`
- in produzione, se il file locale non c'e, scarica l'indice da `INDEX_BLOB_URL` autenticandosi con `BLOB_READ_WRITE_TOKEN`

## Avvio locale
```bash
npm run dev
```
Apri `http://localhost:3000`.

## Deploy su Vercel
1. Pusha repository su GitHub.
2. Importa progetto su Vercel.
3. Imposta in Vercel le stesse env di `.env.local`.
4. Prima del deploy di produzione, genera/aggiorna indice con `npm run ingest`, caricalo con `npm run upload:index` e aggiorna `INDEX_BLOB_URL`.
5. Deploy.

## Comportamento chat
La chat:
- risponde solo dal contesto recuperato (PDF + pagine indicizzate)
- rifiuta domande fuori ambito
- dichiara insufficienza informazioni quando necessario
- mostra sempre sezione **Fonti consultate**

Messaggio di rifiuto fuori scope:
> Posso aiutarti solo su contenuti e informazioni derivati dalle fonti IUSS caricate in questa applicazione.

## Sicurezza (GitHub pubblico)
### Variabili ambiente richieste
- `GEMINI_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `APP_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `BLOB_READ_WRITE_TOKEN` (locale e produzione, per store Blob privato)
- `INDEX_BLOB_URL` (produzione)
- `GEMINI_CHAT_MODEL` (opzionale)
- `GEMINI_EMBED_MODEL` (opzionale)

### Locale
1. Crea `.env.local` (non committarlo).
2. Inserisci chiavi solo in `.env.local`.
3. Non stampare mai chiavi nei log.

### Vercel
1. Project Settings -> Environment Variables.
2. Inserisci le stesse variabili.
3. Ridistribuisci dopo cambi chiavi.

### Quota settimanale domande
Per limitare le domande per utente autenticato:
1. Crea un database Upstash Redis (piano free va bene per iniziare).
2. Copia `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`.
3. Imposta `WEEKLY_QUESTION_LIMIT` (es. `100`).
4. Deploy/redeploy.

Comportamento:
- contatore per utente (`email`) e settimana ISO
- reset automatico all'inizio della settimana successiva
- superato il limite l'API risponde `429` con messaggio chiaro

### Log accessi utente
Se Upstash Redis e configurato, ad ogni login riuscito vengono registrati:
- email utente
- numero totale accessi
- primo accesso
- ultimo accesso

Endpoint disponibile per l'utente autenticato:
- `GET /api/access`

### Verifica anti-leak prima del push
```bash
git status
git diff
```
Controlla che non ci siano file `.env*` con valori reali.

### Rotazione chiavi (best practice minima)
Se una chiave finisce per errore nel repository:
1. revoca/ruota immediatamente la chiave nel provider
2. aggiorna `.env.local` e Vercel
3. invalida eventuali token collegati
4. verifica cronologia git e rimuovi segreti dalla history se necessario

## Struttura progetto
- `app/` UI e API route
- `components/` componenti React piccoli
- `lib/` logica riusabile (Gemini, retrieval, crawling, parsing)
- `scripts/` ingestione indice
- `config/` allowlist e parametri ingest/retrieval
- `types/` tipi TypeScript condivisi
- `data/pdfs/` PDF locali
- `data/index/` indice JSON generato

## Note operative
- Login obbligatorio con Google (`@iusspavia.it`)
- Nessuna area admin
- Nessun CMS
- Nessuna memoria utente
- Chiavi usate solo server-side

