// Copy pdfjs-dist's runtime assets into public/pdfjs/ so the browser can load
// cmaps (CJK encodings), standard fonts (fallbacks for non-embedded fonts), and
// WASM decoders (JBIG2 / OpenJPEG / QCMS — JBIG2 is critical for scanned PDFs).
// Wired into `predev` and `prebuild` so dev and CI both refresh on install.

import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

const dirs = ['cmaps', 'standard_fonts', 'wasm'];

await mkdir(dest, { recursive: true });

for (const d of dirs) {
  const srcPath = resolve(src, d);
  const destPath = resolve(dest, d);
  if (!existsSync(srcPath)) {
    console.error(`[copy-pdfjs-assets] missing source dir: ${srcPath}`);
    process.exit(1);
  }
  await cp(srcPath, destPath, { recursive: true, force: true });
  console.log(`[copy-pdfjs-assets] ${d}/`);
}
