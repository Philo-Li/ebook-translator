# Ebook Translator

A free, browser-only ebook translator. Upload an EPUB or PDF, bring your own LLM API key, and get back a **bilingual edition** with the original and translated text interleaved paragraph by paragraph.

Your book never leaves your browser: parsing, OCR dispatch, translation requests and EPUB generation all run client-side. The only network traffic is between your browser and the LLM provider you chose.

Live instance: **[philoli.com/projects/ebook-translator](https://philoli.com/projects/ebook-translator)**

## Features

- **EPUB and PDF input.** Text PDFs are reconstructed into paragraphs; scanned PDFs are OCR'd page by page with a vision-capable model (formulas included).
- **Bilingual output.** Original and translation side by side, exported as a new EPUB.
- **42 languages** (including Maltese), any direction. The UI itself is translated into 41 locales.
- **Three translation tones**: natural/general, fiction, and professional/technical.
- **Math support.** LaTeX inside the book is rendered with KaTeX and preserved through translation.
- **Custom glossaries.** Upload a CSV term base so domain vocabulary is translated consistently.
- **Resumable sessions.** Progress is saved in IndexedDB; close the tab and pick up where you left off. The ten most recent books stay in history.
- **Bring your own key.** Gemini, OpenAI, Anthropic, DeepSeek, Qwen, GLM, Kimi, OpenRouter, OpenCode, or any OpenAI-compatible endpoint. Keys are stored only in your browser (optional).

## Quick start

```bash
pnpm install        # or npm install
pnpm dev            # http://localhost:5173
```

`pnpm build` type-checks and writes a static site to `dist/`. Deploy that folder to any static host (Cloudflare Pages, Netlify, Vercel, GitHub Pages, nginx, …). Both `dev` and `build` first copy pdf.js runtime assets (CMaps, standard fonts, WASM decoders) into `public/pdfjs/`.

## Usage

1. Pick a provider and paste your API key.
2. Choose source and target languages and a tone.
3. Drop an EPUB or PDF onto the page.
4. Translate chapter by chapter, or click "Translate all remaining".
5. Download the bilingual EPUB.

The UI language follows `?lang=xx` in the URL, then your saved choice, then the browser language.

## Optional: CORS proxy for custom endpoints

Most providers allow browser requests directly. Two options do not:

- **OpenCode** (`opencode.ai/zen/...`)
- **Custom (OpenAI-compatible)** gateways such as OneAPI, NewAPI, FastGPT, or a tunnelled local Ollama

For those, deploy the tiny Cloudflare Worker in [`worker/`](worker/README.md) and point the app at it:

```bash
cp .env.example .env
# VITE_LLM_PROXY_URL=https://your-worker.workers.dev/v1/chat/completions
pnpm build
```

When the variable is unset, the app calls those endpoints directly from the browser, which only works if the upstream sends CORS headers.

## Project layout

```
index.html                 Vite entry
src/main.tsx               React bootstrap
src/App.tsx                App shell: language switcher, theme toggle, header
src/components/
  EbookTranslator.tsx      The whole translator UI (settings → upload → browse)
src/lib/
  epub.ts                  EPUB parsing and bilingual EPUB building
  pdf.ts                   PDF text extraction, paragraph reconstruction, OCR orchestration
  llm.ts                   Provider catalogue, prompt building, translate / OCR calls
  ebook-session.ts         IndexedDB persistence of translation sessions
  glossary-store.ts        IndexedDB persistence of user glossaries
src/i18n/                  UI strings for 41 locales + locale detection
src/styles/
  global.css               Design tokens (dark + light) and app chrome
  ebook-translator.css     Translator UI styles
scripts/copy-pdfjs-assets.mjs
worker/                    Optional Cloudflare Worker CORS proxy
```

## Privacy

- Files are parsed in the browser with pdf.js and JSZip. Nothing is uploaded to this project's servers, because there are none.
- Translation and OCR requests go straight from your browser to the provider you selected, authenticated with your key.
- "Remember key" stores the key in `localStorage` on your device only. Leave it unchecked on shared machines.
- Sessions and glossaries live in your browser's IndexedDB.

## Contributing

Issues and pull requests are welcome. To add a UI language, copy `src/i18n/en.json`, translate the values, and register the file in `src/i18n/index.ts`. To add a provider, extend `PROVIDERS` in `src/lib/llm.ts`.

## License

[MIT](LICENSE) © Philo Li
