import JSZip from 'jszip';
import katex from 'katex';
import MarkdownIt from 'markdown-it';
import { parseEpub, type ParsedEpub } from './epub';

// xhtmlOut: true → void tags self-close, required for EPUB XHTML well-formedness.
const md = new MarkdownIt({ html: false, breaks: false, linkify: false, xhtmlOut: true });

/** Replace `$$…$$` / `$…$` runs with KaTeX MathML — needs no CSS or fonts inside the EPUB. */
function renderMathToMathML(html: string): string {
  let out = html.replace(/\$\$([\s\S]+?)\$\$/g, (m, tex) => {
    try { return katex.renderToString(tex, { displayMode: true, throwOnError: false, output: 'mathml' }); }
    catch { return m; }
  });
  out = out.replace(/\$([^\n$]+?)\$/g, (m, tex) => {
    try { return katex.renderToString(tex, { displayMode: false, throwOnError: false, output: 'mathml' }); }
    catch { return m; }
  });
  return out;
}

/**
 * Render one OCR-derived paragraph to XHTML for the EPUB. Mirrors the in-app preview pipeline so
 * Markdown tables / lists / emphasis and LaTeX math come out as real structure instead of escaped text.
 * For prose ('p'), markdown-it already wraps in <p> (or emits <table>/<ul> directly when appropriate),
 * so we do NOT add an outer <p>.
 */
function paragraphToXhtml(type: ParaTag, text: string): string {
  const t = text.trim();
  if (!t) return '';
  if (type === 'h1' || type === 'h2' || type === 'h3') {
    return `<${type}>${renderMathToMathML(md.renderInline(t))}</${type}>`;
  }
  return renderMathToMathML(md.render(t));
}

/**
 * Thrown by `parsePdf` when the PDF has no text layer at all (a true scanned image).
 * Callers can catch this and route to OCR instead of bubbling the error up.
 */
export class ScannedPdfError extends Error {
  readonly code = 'scanned-pdf';
  constructor(public readonly diag: string, public readonly pageCount: number) {
    super(`Scanned PDF — no text layer detected (${diag}). OCR required.`);
    this.name = 'ScannedPdfError';
  }
}

// pdfjs is heavy (~700KB), keep it dynamically imported so EPUB-only users don't pay for it.
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

async function loadPdfjs(): Promise<typeof import('pdfjs-dist')> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return pdfjs;
  })();
  return pdfjsPromise;
}

/**
 * Cache the loaded PDFDocumentProxy keyed by File/Blob, so the preview panel and the
 * parse/OCR pipeline share one parse pass per upload. WeakMap lets the document
 * get GC'd once the user drops a different file.
 */
const pdfDocCache = new WeakMap<Blob, Promise<any>>();

/**
 * pdfjs ships JBIG2/OpenJPEG/QCMS WASM decoders, CMap encodings, and standard-font fallbacks
 * as separate runtime assets. Without these URLs scanned PDFs (which usually use JBIG2-encoded
 * page images) render as blank white canvases. The asset directories are copied into
 * public/pdfjs/ by `scripts/copy-pdfjs-assets.mjs` (wired into pre{dev,build} npm scripts).
 */
const PDFJS_ASSET_BASE = '/pdfjs/';

async function loadPdfDocument(file: File | Blob): Promise<any> {
  let cached = pdfDocCache.get(file);
  if (cached) return cached;
  cached = (async () => {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await file.arrayBuffer());
    return pdfjs.getDocument({
      data,
      cMapUrl: `${PDFJS_ASSET_BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_ASSET_BASE}standard_fonts/`,
      wasmUrl: `${PDFJS_ASSET_BASE}wasm/`,
    }).promise;
  })();
  pdfDocCache.set(file, cached);
  return cached;
}

/**
 * Quick classification of a freshly-uploaded PDF: how many pages, and does any text layer
 * exist (sample the first few pages — full inspection happens in `parsePdf`).
 */
export async function detectPdfScannedStatus(file: File | Blob): Promise<{
  pageCount: number;
  isScanned: boolean;
  diag: string;
}> {
  const pdf = await loadPdfDocument(file);
  const sampleN = Math.min(3, pdf.numPages);
  let totalItems = 0;
  let totalChars = 0;
  for (let i = 1; i <= sampleN; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    for (const it of tc.items as any[]) {
      if (typeof it?.str === 'string' && it.str.length > 0) {
        totalItems++;
        totalChars += it.str.length;
      }
    }
  }
  return {
    pageCount: pdf.numPages,
    isScanned: totalItems === 0 || totalChars === 0,
    diag: `pages=${pdf.numPages}, sampled=${sampleN}, items=${totalItems}, chars=${totalChars}`,
  };
}

/** Render one page as a JPEG (base64) — used for the "translate this page" test flow. */
export async function renderSinglePageAsJpeg(
  file: File | Blob,
  pageNumber: number,
  maxDim = 1600,
  jpegQuality = 0.85,
): Promise<{ base64: string; mimeType: string }> {
  const pdf = await loadPdfDocument(file);
  return renderPageAsJpeg(pdf, pageNumber, maxDim, jpegQuality);
}

/**
 * Extract structured paragraphs from a single text-layer page — mirrors the per-page work
 * inside `parsePdf`, exposed for the "translate this page" test flow so users can preview a
 * single page's translation before committing to the whole book.
 */
export async function extractSinglePageParagraphs(
  file: File | Blob,
  pageNumber: number,
): Promise<Paragraph[]> {
  const pdf = await loadPdfDocument(file);
  const bodyFontSize = await detectBodyFontSize(pdf);
  const page = await pdf.getPage(pageNumber);
  const lines = await extractPageLines(page);
  return linesToParagraphs(lines, bodyFontSize);
}

/** Render a specific page into a caller-provided canvas. Used by the preview panel. */
export async function renderPdfPageToCanvas(
  file: File | Blob,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxDim: number,
): Promise<void> {
  const pdf = await loadPdfDocument(file);
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.1, maxDim / Math.max(baseViewport.width, baseViewport.height));
  const viewport = page.getViewport({ scale });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
}

interface Line {
  text: string;
  x: number;
  /** Top-origin Y (larger = lower on page). */
  y: number;
  fontSize: number;
}

export type ParaTag = 'p' | 'h1' | 'h2' | 'h3';

export interface Paragraph {
  type: ParaTag;
  text: string;
  /** 0-based source page; set by the PDF extractor so embedded images can interleave per page. */
  pageIndex?: number;
}

interface PdfPage {
  pageIndex: number;
  paragraphs: Paragraph[];
}

interface PdfChapter {
  title: string;
  pages: PdfPage[];
}

interface PageImage {
  pageIndex: number;
  base64: string;
  mimeType: string;
}

const EMBED_MAX_DIM = 1600;
const EMBED_QUALITY = 0.75;

/** Bucket consecutive same-page paragraphs into PdfPage records. */
function groupByPage(paras: Paragraph[]): PdfPage[] {
  const pages: PdfPage[] = [];
  for (const p of paras) {
    const idx = p.pageIndex ?? -1;
    const last = pages[pages.length - 1];
    if (last && last.pageIndex === idx) last.paragraphs.push(p);
    else pages.push({ pageIndex: idx, paragraphs: [p] });
  }
  return pages;
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface OutlineEntry {
  title: string;
  /** 0-based page index. */
  pageIndex: number;
}

interface PageStats {
  itemCount: number;
  emptyStrCount: number;
  nonEmptyStrCount: number;
  totalChars: number;
}

/**
 * Extract logical lines from a single page by clustering text items by Y coordinate.
 * pdfjs gives positioned glyph runs; we group runs with similar Y into one line, then
 * sort the runs in each line by X.
 */
async function extractPageLines(page: any, stats?: PageStats): Promise<Line[]> {
  const tc = await page.getTextContent();
  type Run = { str: string; x: number; y: number; fontSize: number };
  const runs: Run[] = [];
  for (const it of tc.items as any[]) {
    if (typeof it.str !== 'string') continue;
    if (stats) {
      stats.itemCount++;
      if (it.str.length === 0) stats.emptyStrCount++;
      else { stats.nonEmptyStrCount++; stats.totalChars += it.str.length; }
    }
    if (it.str.length === 0) continue;
    const t = it.transform as number[] | undefined;
    if (!t) continue;
    const fontSize = Math.hypot(t[2], t[3]) || (typeof it.height === 'number' ? it.height : 12);
    runs.push({ str: it.str, x: t[4], y: -t[5], fontSize });
  }
  if (runs.length === 0) return [];

  runs.sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: Line[] = [];
  let buf: Run[] = [];
  let bufY = 0;
  let bufFontSize = 12;

  const flush = () => {
    if (buf.length === 0) return;
    buf.sort((a, b) => a.x - b.x);
    const text = buf.map(r => r.str).join('').replace(/\s+/g, ' ').trim();
    if (text) {
      const meanFontSize = buf.reduce((s, r) => s + r.fontSize, 0) / buf.length;
      lines.push({ text, x: buf[0].x, y: bufY, fontSize: meanFontSize });
    }
    buf = [];
  };

  for (const r of runs) {
    if (buf.length === 0) {
      buf.push(r);
      bufY = r.y;
      bufFontSize = r.fontSize;
      continue;
    }
    const tol = Math.max(bufFontSize * 0.5, 3);
    if (Math.abs(r.y - bufY) <= tol) {
      buf.push(r);
      bufFontSize = Math.max(bufFontSize, r.fontSize);
    } else {
      flush();
      buf.push(r);
      bufY = r.y;
      bufFontSize = r.fontSize;
    }
  }
  flush();
  return lines;
}

function isPageNumberOnly(text: string): boolean {
  const t = text.trim();
  if (/^\d{1,4}$/.test(t)) return true;
  if (/^[ivxlcdm]{1,8}$/i.test(t)) return true;
  return false;
}

/** Join two consecutive lines, dehyphenating "wo-\nrd" → "word". */
function joinLines(prev: string, next: string): string {
  if (prev.endsWith('-') && /^[a-z]/.test(next)) return prev.slice(0, -1) + next;
  return prev + ' ' + next;
}

/**
 * Group lines into paragraphs using vertical gap and indentation as boundaries.
 * Heading-sized lines become their own h1/h2/h3 paragraph.
 */
function linesToParagraphs(lines: Line[], bodyFontSize: number): Paragraph[] {
  const filtered = lines.filter(l => !isPageNumberOnly(l.text));
  if (filtered.length === 0) return [];

  const headingTag = (size: number): ParaTag => {
    if (size >= bodyFontSize * 1.6) return 'h1';
    if (size >= bodyFontSize * 1.3) return 'h2';
    if (size >= bodyFontSize * 1.12) return 'h3';
    return 'p';
  };

  const paragraphs: Paragraph[] = [];
  let buf: Line[] = [];
  let bufTag: ParaTag = 'p';

  const flush = () => {
    if (buf.length === 0) return;
    let text = buf[0].text;
    for (let i = 1; i < buf.length; i++) text = joinLines(text, buf[i].text);
    text = text.replace(/\s+/g, ' ').trim();
    if (text) paragraphs.push({ type: bufTag, text });
    buf = [];
  };

  for (let i = 0; i < filtered.length; i++) {
    const ln = filtered[i];
    const tag = headingTag(ln.fontSize);
    if (buf.length === 0) {
      buf.push(ln);
      bufTag = tag;
      continue;
    }
    const prev = filtered[i - 1];
    const gap = ln.y - prev.y;
    const lineHeight = Math.max(ln.fontSize, prev.fontSize) * 1.2;
    const tagChanged = tag !== bufTag;
    const bigGap = gap > lineHeight * 1.7;
    const newIndent = ln.x - prev.x > prev.fontSize * 1.3;
    if (tagChanged || bigGap || newIndent) {
      flush();
      buf.push(ln);
      bufTag = tag;
    } else {
      buf.push(ln);
    }
  }
  flush();
  return paragraphs;
}

/** Sample a few middle pages to guess the body text font size (mode of all glyph sizes). */
async function detectBodyFontSize(pdf: any): Promise<number> {
  const total = pdf.numPages;
  const sampleCount = Math.min(5, total);
  const start = Math.max(1, Math.floor(total / 2) - Math.floor(sampleCount / 2));
  const counts = new Map<number, number>();
  for (let i = 0; i < sampleCount; i++) {
    const p = await pdf.getPage(start + i);
    const tc = await p.getTextContent();
    for (const it of tc.items as any[]) {
      const t = it.transform as number[] | undefined;
      if (!t) continue;
      const sz = Math.round(Math.hypot(t[2], t[3]) * 10) / 10;
      if (sz > 0) counts.set(sz, (counts.get(sz) ?? 0) + 1);
    }
  }
  let bestSize = 12;
  let bestCount = 0;
  for (const [sz, c] of counts) {
    if (c > bestCount) { bestCount = c; bestSize = sz; }
  }
  return bestSize;
}

/** Resolve PDF outline (TOC) entries to page indices. */
async function getChapterOutline(pdf: any): Promise<OutlineEntry[]> {
  const outline = await pdf.getOutline().catch(() => null);
  if (!outline || outline.length === 0) return [];

  const flat: { title: string; dest: any }[] = [];
  const walk = (nodes: any[]) => {
    for (const n of nodes) {
      flat.push({ title: typeof n.title === 'string' ? n.title : '', dest: n.dest });
      if (Array.isArray(n.items) && n.items.length > 0) walk(n.items);
    }
  };
  walk(outline);

  const resolved: OutlineEntry[] = [];
  for (const { title, dest } of flat) {
    const cleanTitle = title.trim();
    if (!cleanTitle) continue;
    try {
      let arr = dest;
      if (typeof arr === 'string') arr = await pdf.getDestination(arr);
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const idx = await pdf.getPageIndex(arr[0]);
      if (typeof idx === 'number' && idx >= 0) {
        resolved.push({ title: cleanTitle, pageIndex: idx });
      }
    } catch {
      // Some destinations can't be resolved (broken links etc.) — skip.
    }
  }
  resolved.sort((a, b) => a.pageIndex - b.pageIndex);
  // Drop duplicates that point at the same page (keep the first).
  const out: OutlineEntry[] = [];
  for (const e of resolved) {
    if (out.length > 0 && out[out.length - 1].pageIndex === e.pageIndex) continue;
    out.push(e);
  }
  return out;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function pageImageHref(pageIndex: number): string {
  return `images/page-${pageIndex + 1}.jpg`;
}

function chapterXhtml(title: string, pages: PdfPage[], imagePages: Set<number>): string {
  const sections = pages.map(page => {
    const figure = imagePages.has(page.pageIndex)
      ? `<figure class="pdf-page"><img src="${pageImageHref(page.pageIndex)}" alt="Page ${page.pageIndex + 1}"/></figure>`
      : '';
    const paras = page.paragraphs
      .map(p => paragraphToXhtml(p.type, p.text))
      .filter(Boolean)
      .join('\n');
    return figure ? `${figure}\n${paras}` : paras;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escapeXml(title)}</title></head>
<body>
<h1>${escapeXml(title)}</h1>
${sections}
</body>
</html>`;
}

async function buildSyntheticEpub(
  meta: { title: string; author: string; language: string },
  chapters: PdfChapter[],
  images: PageImage[],
): Promise<Blob> {
  const zip = new JSZip();
  // EPUB requires "mimetype" first, stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const items = chapters.map((c, i) => ({
    id: `ch${i}`,
    href: `chapter-${i + 1}.xhtml`,
    title: c.title,
    pages: c.pages,
  }));

  // Track which page images actually made it into the zip so the chapter XHTML can skip
  // <figure> tags for pages whose JPEG render failed (rather than emit broken-image refs).
  const imagePages = new Set(images.map(img => img.pageIndex));

  for (const it of items) {
    zip.file(`OEBPS/${it.href}`, chapterXhtml(it.title, it.pages, imagePages));
  }

  // Embed page images.
  for (const img of images) {
    zip.file(`OEBPS/${pageImageHref(img.pageIndex)}`, base64ToUint8(img.base64));
  }

  const manifestChapters = items
    .map(it => `    <item id="${it.id}" href="${it.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');
  // First rendered page becomes the cover — flag it with EPUB3 `properties="cover-image"`
  // and an EPUB2 `<meta name="cover">` so Kindle/Apple Books/Calibre all pick it up.
  const coverPageIndex = images.length > 0
    ? images.reduce((min, img) => (img.pageIndex < min ? img.pageIndex : min), images[0].pageIndex)
    : -1;
  const manifestImages = images
    .map(img => {
      const isCover = img.pageIndex === coverPageIndex;
      const props = isCover ? ' properties="cover-image"' : '';
      return `    <item id="img-${img.pageIndex + 1}" href="${pageImageHref(img.pageIndex)}" media-type="${img.mimeType}"${props}/>`;
    })
    .join('\n');
  const coverMeta = coverPageIndex >= 0
    ? `\n    <meta name="cover" content="img-${coverPageIndex + 1}"/>`
    : '';
  const spine = items.map(it => `    <itemref idref="${it.id}"/>`).join('\n');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(meta.title)}</dc:title>
    <dc:creator>${escapeXml(meta.author)}</dc:creator>
    <dc:language>${escapeXml(meta.language)}</dc:language>
    <dc:identifier id="bookid">pdf-${Date.now()}</dc:identifier>${coverMeta}
  </metadata>
  <manifest>
${manifestChapters}${manifestImages ? '\n' + manifestImages : ''}
  </manifest>
  <spine>
${spine}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

/**
 * Parse a PDF, reconstruct paragraphs heuristically, and synthesize an EPUB so the
 * downstream translation pipeline can treat it identically to a real EPUB.
 *
 * Limitations:
 *   - Scanned PDFs without a text layer return no text and throw.
 *   - Math, footnotes, multi-column layouts may not reflow cleanly.
 *   - Headings inferred from font size; if the PDF uses uniform sizing, all paragraphs
 *     are tagged as <p>.
 */
export async function parsePdf(file: File | Blob): Promise<ParsedEpub> {
  const pdf = await loadPdfDocument(file);

  const metaResult = await pdf.getMetadata().catch(() => null);
  const info = (metaResult?.info ?? {}) as { Title?: string; Author?: string; Language?: string };
  let title = (info.Title ?? '').trim();
  if (!title) title = file instanceof File ? file.name.replace(/\.pdf$/i, '') : 'Untitled';
  const author = (info.Author ?? '').trim() || 'Unknown';
  const language = (info.Language ?? '').trim() || 'en';

  const bodyFontSize = await detectBodyFontSize(pdf);
  const outline = await getChapterOutline(pdf);

  const pageParas: Paragraph[][] = [];
  const stats: PageStats = { itemCount: 0, emptyStrCount: 0, nonEmptyStrCount: 0, totalChars: 0 };
  let totalLines = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const lines = await extractPageLines(page, stats);
    totalLines += lines.length;
    const paras = linesToParagraphs(lines, bodyFontSize);
    for (const p of paras) p.pageIndex = i - 1;
    pageParas.push(paras);
  }

  let chapters: PdfChapter[];
  if (outline.length >= 2) {
    chapters = [];
    if (outline[0].pageIndex > 0) {
      const front: Paragraph[] = [];
      for (let p = 0; p < outline[0].pageIndex; p++) front.push(...pageParas[p]);
      if (front.length > 0) chapters.push({ title: 'Front matter', pages: groupByPage(front) });
    }
    for (let i = 0; i < outline.length; i++) {
      const entry = outline[i];
      const endPage = i + 1 < outline.length ? outline[i + 1].pageIndex : pdf.numPages;
      const paras: Paragraph[] = [];
      for (let p = entry.pageIndex; p < endPage; p++) paras.push(...pageParas[p]);
      // If the chapter's first paragraph repeats the outline title, drop it — the
      // synthesized XHTML will use the outline title as the <h1>.
      if (paras.length > 0 && normalize(paras[0].text) === normalize(entry.title)) {
        paras.shift();
      }
      chapters.push({ title: entry.title, pages: groupByPage(paras) });
    }
  } else {
    // No outline — try to split on inferred h1 headings, else one big chapter.
    const all: Paragraph[] = [];
    for (const ps of pageParas) all.push(...ps);
    const hasH1 = all.some(p => p.type === 'h1');
    if (hasH1) {
      chapters = [];
      let curParas: Paragraph[] = [];
      let curTitle = title;
      for (const p of all) {
        if (p.type === 'h1') {
          if (curParas.length > 0) chapters.push({ title: curTitle, pages: groupByPage(curParas) });
          curTitle = p.text;
          curParas = [];
        } else {
          curParas.push(p);
        }
      }
      if (curParas.length > 0) chapters.push({ title: curTitle, pages: groupByPage(curParas) });
    } else {
      chapters = [{ title, pages: groupByPage(all) }];
    }
  }

  chapters = chapters.filter(c => c.pages.length > 0);
  if (chapters.length === 0) {
    // Diagnose the failure: distinguish a true scanned PDF, an undecodable text layer,
    // and a paragraph-reconstruction miss.
    const diag = `pages=${pdf.numPages}, items=${stats.itemCount}, decoded=${stats.nonEmptyStrCount}, chars=${stats.totalChars}, lines=${totalLines}`;
    // eslint-disable-next-line no-console
    console.warn('[pdf] empty extraction:', diag);
    if (stats.itemCount === 0) {
      throw new ScannedPdfError(diag, pdf.numPages);
    }
    if (stats.nonEmptyStrCount === 0 || stats.totalChars === 0) {
      throw new Error(
        `PDF has a text layer but PDF.js couldn't decode any characters — likely uses non-standard font encoding (${diag}). Try re-exporting the PDF with embedded ToUnicode tables, or open it in another reader to copy text.`,
      );
    }
    if (totalLines === 0) {
      throw new Error(`Extracted text but couldn't form any lines (${diag}). Please report this PDF.`);
    }
    throw new Error(
      `Extracted ${totalLines} lines but all were filtered out as page numbers or empty paragraphs (${diag}). Please report this PDF.`,
    );
  }

  // Render embedded page images for every page that survived into a chapter.
  // Per-page failures degrade gracefully — the chapter XHTML will simply omit the figure
  // for any page whose JPEG render threw, instead of bailing out the whole export.
  const usedPages = new Set<number>();
  for (const c of chapters) for (const pg of c.pages) usedPages.add(pg.pageIndex);
  const images: PageImage[] = [];
  for (const pageIndex of Array.from(usedPages).sort((a, b) => a - b)) {
    if (pageIndex < 0) continue;
    try {
      const img = await renderPageAsJpeg(pdf, pageIndex + 1, EMBED_MAX_DIM, EMBED_QUALITY);
      images.push({ pageIndex, base64: img.base64, mimeType: img.mimeType });
    } catch (e) {
      console.warn(`[pdf] page ${pageIndex + 1} image render failed:`, e);
    }
  }

  const epubBlob = await buildSyntheticEpub({ title, author, language }, chapters, images);
  return parseEpub(epubBlob);
}

// =============================================================================
// OCR mode — for scanned PDFs (no text layer). Renders each page to a JPEG and
// hands it to a caller-supplied LLM-vision OCR function. The output is glued
// together into the same synthetic-EPUB structure as the text-layer path.
// =============================================================================

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000; // stay under stack-spread limits for older engines
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Render a PDF page to a JPEG, scaled so the larger dimension is `maxDim` px. */
async function renderPageAsJpeg(
  pdf: any,
  pageNumber: number,
  maxDim: number,
  quality: number,
): Promise<{ base64: string; mimeType: string }> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.max(0.1, Math.min(maxDim / baseViewport.width, maxDim / baseViewport.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/jpeg', quality),
  );
  // Free the canvas-backed buffer eagerly — books can have hundreds of pages.
  canvas.width = 0;
  canvas.height = 0;
  const buf = await blob.arrayBuffer();
  return { base64: arrayBufferToBase64(buf), mimeType: 'image/jpeg' };
}

/**
 * Build a bilingual EPUB directly from per-page trial-translate results (no chapter parse).
 * Each input page becomes a `<figure><img/></figure>` followed by orig + translation pairs,
 * matching the interleaved layout produced by buildBilingualEpub on parsed chapters.
 */
export async function buildPdfBilingualEpubFromPages(opts: {
  file: File | Blob;
  pages: Array<{ pageIndex: number; items: Array<{ type: ParaTag; original: string; translated: string }> }>;
  meta: { title: string; author: string; language: string };
}): Promise<Blob> {
  const sorted = [...opts.pages].sort((a, b) => a.pageIndex - b.pageIndex);
  const pdf = await loadPdfDocument(opts.file);
  const images: PageImage[] = [];
  // Per-page render failures degrade to text-only for that page rather than aborting the export.
  for (const p of sorted) {
    try {
      const img = await renderPageAsJpeg(pdf, p.pageIndex + 1, EMBED_MAX_DIM, EMBED_QUALITY);
      images.push({ pageIndex: p.pageIndex, base64: img.base64, mimeType: img.mimeType });
    } catch (e) {
      console.warn(`[pdf] page ${p.pageIndex + 1} image render failed:`, e);
    }
  }
  // Flatten each page's items into an alternating sequence of original / translation paragraphs.
  const chapterPages: PdfPage[] = sorted.map(p => ({
    pageIndex: p.pageIndex,
    paragraphs: p.items.flatMap(it => {
      const rows: Paragraph[] = [{ type: it.type, text: it.original, pageIndex: p.pageIndex }];
      if (it.translated) rows.push({ type: it.type, text: it.translated, pageIndex: p.pageIndex });
      return rows;
    }),
  }));
  const chapters: PdfChapter[] = [{ title: opts.meta.title || 'Bilingual', pages: chapterPages }];
  return buildSyntheticEpub(opts.meta, chapters, images);
}

/** Parse the LLM's lightweight Markdown OCR output into typed paragraphs. */
export function parseOcrMarkdown(text: string): Paragraph[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const blocks = trimmed.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out: Paragraph[] = [];

  const headingKind = (line: string): { kind: ParaTag; rest: string } | null => {
    if (line.startsWith('### ')) return { kind: 'h3', rest: line.slice(4) };
    if (line.startsWith('## '))  return { kind: 'h2', rest: line.slice(3) };
    if (line.startsWith('# '))   return { kind: 'h1', rest: line.slice(2) };
    return null;
  };

  for (const block of blocks) {
    // Tables and lists must keep their line structure intact; treat the whole block as one paragraph.
    const structural = /^\s*\|/m.test(block) || /^\s*([-*+]|\d+[.)])\s/m.test(block);
    if (structural) {
      const first = block.split('\n', 1)[0];
      const head = headingKind(first);
      const kind: ParaTag = head ? head.kind : 'p';
      const body = head ? [head.rest, ...block.split('\n').slice(1)].join('\n') : block;
      const content = body.split('\n').map(l => l.trimEnd()).filter(Boolean).join('\n').trim();
      if (content) out.push({ type: kind, text: content });
      continue;
    }
    // Plain prose: split heading lines into their own paragraphs, collapse line-wrap within prose.
    let prose: string[] = [];
    const flushProse = () => {
      const content = prose.join(' ').replace(/\s+/g, ' ').trim();
      if (content) out.push({ type: 'p', text: content });
      prose = [];
    };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const head = headingKind(line);
      if (head) {
        flushProse();
        if (head.rest.trim()) out.push({ type: head.kind, text: head.rest.trim() });
      } else {
        prose.push(line);
      }
    }
    flushProse();
  }
  return out;
}

function splitOcrParagraphsIntoChapters(paragraphs: Paragraph[], fallbackTitle: string): PdfChapter[] {
  const hasH1 = paragraphs.some(p => p.type === 'h1');
  if (!hasH1) return [{ title: fallbackTitle, pages: groupByPage(paragraphs) }];
  const chapters: PdfChapter[] = [];
  let curTitle = fallbackTitle;
  let curParas: Paragraph[] = [];
  for (const p of paragraphs) {
    if (p.type === 'h1') {
      if (curParas.length > 0) chapters.push({ title: curTitle, pages: groupByPage(curParas) });
      curTitle = p.text;
      curParas = [];
    } else {
      curParas.push(p);
    }
  }
  if (curParas.length > 0) chapters.push({ title: curTitle, pages: groupByPage(curParas) });
  return chapters.filter(c => c.pages.length > 0);
}

interface TocEntry { title: string; printedPage: number }

const TOC_HEADER_RE = /^#{1,3}\s*(目录|目錄|目次|Contents|Table of Contents|Index|Inhalt|Sommaire|Índice|Содержание)\s*$/im;

/** Find the first OCR'd page whose top heading reads like a table of contents. */
function findTocPageIndex(pageTexts: string[]): number {
  for (let i = 0; i < pageTexts.length; i++) {
    if (TOC_HEADER_RE.test(pageTexts[i] ?? '')) return i;
  }
  return -1;
}

/** Pull `{ title, printedPage }` entries out of an OCR'd TOC page. */
function parseTocEntries(tocText: string): TocEntry[] {
  const entries: TocEntry[] = [];
  // Common patterns: "Title ........ 15", "Title  15", "1. Title  15"
  const dotted = /^(.{2,}?)\s*[.…．·\s]{2,}(\d{1,4})\s*$/;
  const plain = /^(.{2,}?)\s{2,}(\d{1,4})\s*$/;
  for (const raw of tocText.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = dotted.exec(line) ?? plain.exec(line);
    if (!m) continue;
    const title = m[1].trim();
    const printedPage = parseInt(m[2], 10);
    if (!title || !Number.isFinite(printedPage)) continue;
    if (title.length < 2 || title.length > 200) continue;
    entries.push({ title, printedPage });
  }
  return entries;
}

const SPACE_RE = /\s+/g;
function fuzzyKey(s: string): string {
  return s.toLowerCase().replace(SPACE_RE, ' ').trim();
}

/** Walk OCR'd pages, mark which PDF page each TOC entry's chapter actually starts on. */
function matchTocEntriesToPdfPages(
  toc: TocEntry[],
  pageTexts: string[],
): Array<{ entry: TocEntry; pdfPageIdx: number }> {
  const out: Array<{ entry: TocEntry; pdfPageIdx: number }> = [];
  let searchFrom = 0;
  for (const entry of toc) {
    const target = fuzzyKey(entry.title);
    let found = -1;
    for (let i = searchFrom; i < pageTexts.length; i++) {
      const text = pageTexts[i] ?? '';
      for (const m of text.matchAll(/^#\s+(.+)$/gm)) {
        const h1 = fuzzyKey(m[1]);
        if (h1 === target || h1.includes(target) || target.includes(h1)) {
          found = i;
          break;
        }
      }
      if (found >= 0) break;
    }
    if (found >= 0) {
      out.push({ entry, pdfPageIdx: found });
      searchFrom = found + 1;
    }
  }
  return out;
}

/** Build chapters using TOC anchors + per-paragraph pageIndex. Skip TOC text out of body. */
function splitParagraphsByTocAnchors(
  paragraphs: Paragraph[],
  anchors: Array<{ entry: TocEntry; pdfPageIdx: number }>,
  totalPages: number,
  fallbackTitle: string,
): PdfChapter[] {
  const chapters: PdfChapter[] = [];
  // Front matter before the first anchor.
  const firstAnchorPage = anchors[0].pdfPageIdx;
  const front = paragraphs.filter(p =>
    typeof p.pageIndex === 'number' && p.pageIndex < firstAnchorPage,
  );
  if (front.length > 0) chapters.push({ title: 'Front matter', pages: groupByPage(front) });
  for (let i = 0; i < anchors.length; i++) {
    const start = anchors[i].pdfPageIdx;
    const end = i + 1 < anchors.length ? anchors[i + 1].pdfPageIdx : totalPages;
    const chapterParas = paragraphs.filter(p =>
      typeof p.pageIndex === 'number' && p.pageIndex >= start && p.pageIndex < end,
    );
    // Drop a leading paragraph that just repeats the chapter title.
    if (chapterParas.length > 0 && fuzzyKey(chapterParas[0].text) === fuzzyKey(anchors[i].entry.title)) {
      chapterParas.shift();
    }
    if (chapterParas.length === 0) continue;
    chapters.push({ title: anchors[i].entry.title, pages: groupByPage(chapterParas) });
  }
  return chapters.length > 0 ? chapters : [{ title: fallbackTitle, pages: groupByPage(paragraphs) }];
}

export interface OcrPageProgress {
  total: number;
  done: number;
  failed: number;
  /** 0-based index of a page that just started rendering (for "now on page X" UI). */
  current?: number;
}

export type OcrPageFn = (
  jpegBase64: string,
  mimeType: string,
  pageIndex: number,
  signal: AbortSignal,
) => Promise<string>;

export interface PdfOcrOptions {
  /** Longest-edge target in pixels for each rendered page image. ~1600 ≈ Gemini 3 "high". */
  maxDim?: number;
  /** JPEG quality, 0..1. */
  jpegQuality?: number;
  /** Pages to OCR in parallel. Higher = faster but more rate-limit pressure. */
  concurrency?: number;
  onProgress?: (p: OcrPageProgress) => void;
  signal?: AbortSignal;
}

/**
 * Render each page of a scanned PDF and route it through the caller-supplied OCR
 * function (typically an LLM vision endpoint). The page text is then parsed as
 * lightweight Markdown and stitched into the same synthetic EPUB structure as
 * `parsePdf`, so downstream translation/output code is unchanged.
 *
 * Failed pages are skipped (left empty), surfaced via the `failed` counter on
 * progress events. If every page fails the function throws.
 */
export async function parsePdfWithOcr(
  file: File | Blob,
  ocrPage: OcrPageFn,
  options: PdfOcrOptions = {},
): Promise<ParsedEpub> {
  const maxDim = options.maxDim ?? 1600;
  const jpegQuality = options.jpegQuality ?? 0.85;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const signal = options.signal;

  const pdf = await loadPdfDocument(file);

  const metaResult = await pdf.getMetadata().catch(() => null);
  const info = (metaResult?.info ?? {}) as { Title?: string; Author?: string; Language?: string };
  let title = (info.Title ?? '').trim();
  if (!title) title = file instanceof File ? file.name.replace(/\.pdf$/i, '') : 'Untitled';
  const author = (info.Author ?? '').trim() || 'Unknown';
  const language = (info.Language ?? '').trim() || 'en';

  const N = pdf.numPages;
  const pageTexts: string[] = new Array(N).fill('');
  let done = 0;
  let failed = 0;
  const fireProgress = (current?: number) =>
    options.onProgress?.({ total: N, done, failed, current });
  fireProgress();

  let nextIdx = 0;
  const work = async () => {
    while (true) {
      if (signal?.aborted) return;
      const i = nextIdx++;
      if (i >= N) return;
      fireProgress(i);
      try {
        const { base64, mimeType } = await renderPageAsJpeg(pdf, i + 1, maxDim, jpegQuality);
        if (signal?.aborted) return;
        pageTexts[i] = await ocrPage(base64, mimeType, i, signal ?? new AbortController().signal);
        done++;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError' || signal?.aborted) return;
        failed++;
        // eslint-disable-next-line no-console
        console.warn(`[pdf-ocr] page ${i + 1} failed:`, e);
      }
      fireProgress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, N) }, work));

  if (signal?.aborted) {
    const err = new Error('OCR cancelled');
    err.name = 'AbortError';
    throw err;
  }

  const allParas: Paragraph[] = [];
  for (let i = 0; i < N; i++) {
    if (!pageTexts[i]) continue;
    const paras = parseOcrMarkdown(pageTexts[i]);
    for (const p of paras) p.pageIndex = i;
    allParas.push(...paras);
  }

  if (allParas.length === 0) {
    throw new Error(
      `OCR completed but produced no usable text (${failed}/${N} pages failed). Try a different vision model — the current one may not OCR this script.`,
    );
  }

  // Chapter splitting priority:
  //   1. PDF's embedded outline (rare on scans, but cheap to check)
  //   2. OCR'd "Contents" page parsed for printed-page anchors, matched against h1 headings
  //   3. Fall back to inferred h1 headings in the OCR text
  let chapters: PdfChapter[] | null = null;
  const outline = await getChapterOutline(pdf);
  if (outline.length >= 2) {
    chapters = [];
    if (outline[0].pageIndex > 0) {
      const front = allParas.filter(p =>
        typeof p.pageIndex === 'number' && p.pageIndex < outline[0].pageIndex,
      );
      if (front.length > 0) chapters.push({ title: 'Front matter', pages: groupByPage(front) });
    }
    for (let i = 0; i < outline.length; i++) {
      const start = outline[i].pageIndex;
      const end = i + 1 < outline.length ? outline[i + 1].pageIndex : N;
      const chapterParas = allParas.filter(p =>
        typeof p.pageIndex === 'number' && p.pageIndex >= start && p.pageIndex < end,
      );
      if (chapterParas.length > 0 && fuzzyKey(chapterParas[0].text) === fuzzyKey(outline[i].title)) {
        chapterParas.shift();
      }
      if (chapterParas.length > 0) chapters.push({ title: outline[i].title, pages: groupByPage(chapterParas) });
    }
    if (chapters.length < 2) chapters = null;
  }
  if (!chapters) {
    const tocIdx = findTocPageIndex(pageTexts);
    if (tocIdx >= 0) {
      const entries = parseTocEntries(pageTexts[tocIdx]);
      if (entries.length >= 2) {
        const anchors = matchTocEntriesToPdfPages(entries, pageTexts);
        if (anchors.length >= 2) {
          // Exclude the TOC page itself from chapter body so it doesn't get translated as prose.
          const body = allParas.filter(p => p.pageIndex !== tocIdx);
          chapters = splitParagraphsByTocAnchors(body, anchors, N, title);
        }
      }
    }
  }
  if (!chapters) {
    chapters = splitOcrParagraphsIntoChapters(allParas, title);
  }
  // Render embedded page images for every page that ended up with content. The OCR pass
  // already rendered each page at its higher input dims; we re-render here at the smaller
  // embed dims so the output EPUB stays compact. Per-page failures degrade gracefully —
  // the chapter XHTML simply omits the figure for any page whose render threw.
  const usedPages = new Set<number>();
  for (const c of chapters) for (const pg of c.pages) usedPages.add(pg.pageIndex);
  const images: PageImage[] = [];
  for (const pageIndex of Array.from(usedPages).sort((a, b) => a - b)) {
    if (pageIndex < 0) continue;
    try {
      const img = await renderPageAsJpeg(pdf, pageIndex + 1, EMBED_MAX_DIM, EMBED_QUALITY);
      images.push({ pageIndex, base64: img.base64, mimeType: img.mimeType });
    } catch (e) {
      console.warn(`[pdf] page ${pageIndex + 1} image render failed:`, e);
    }
  }

  const epubBlob = await buildSyntheticEpub({ title, author, language }, chapters, images);
  return parseEpub(epubBlob);
}
