import JSZip from 'jszip';

export interface EpubMetadata {
  title: string;
  author: string;
  language: string;
}

export interface TranslatableNode {
  /** Stable id used to map translations back to the DOM. */
  id: string;
  /** Plain text content sent to the translator (with math/code replaced by ⟦Mn⟧ placeholders). */
  text: string;
  /** Raw HTML chunks (math, code, inline tags) keyed by ⟦Mn⟧ placeholder index. */
  preserved: string[];
}

export interface ChapterFile {
  /** Path inside the zip, e.g. "OEBPS/chapter1.xhtml". */
  href: string;
  /** Display title — first heading inside the chapter, or filename fallback. */
  title: string;
  /** Original raw XHTML content. */
  raw: string;
  /** Parsed DOM of the chapter. */
  doc: Document;
  /** Translatable text nodes in document order. */
  nodes: TranslatableNode[];
}

export interface ParsedEpub {
  zip: JSZip;
  opfPath: string;
  metadata: EpubMetadata;
  /** Spine files in reading order (only XHTML chapters). */
  chapters: ChapterFile[];
}

const TRANSLATABLE_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, li';

const xmlSerializer = new XMLSerializer();

function parseXml(raw: string, mime: DOMParserSupportedType = 'application/xhtml+xml'): Document {
  const doc = new DOMParser().parseFromString(raw, mime);
  const error = doc.querySelector('parsererror');
  if (error) {
    // Some readers ship malformed XHTML; fall back to HTML parser so we don't crash.
    return new DOMParser().parseFromString(raw, 'text/html');
  }
  return doc;
}

function serializeXml(doc: Document): string {
  return xmlSerializer.serializeToString(doc);
}

function readMetadata(opfDoc: Document): EpubMetadata {
  const get = (tag: string) => {
    const el = opfDoc.getElementsByTagName(tag)[0] ?? opfDoc.getElementsByTagNameNS('*', tag)[0];
    return el?.textContent?.trim() ?? '';
  };
  return {
    title: get('dc:title') || get('title') || 'Untitled',
    author: get('dc:creator') || get('creator') || 'Unknown',
    language: get('dc:language') || get('language') || 'en',
  };
}

function resolveHref(opfPath: string, href: string): string {
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  // Strip URL fragment.
  const clean = href.split('#')[0];
  // Naive resolve: most EPUBs use relative paths in the OPF dir.
  if (clean.startsWith('/')) return clean.slice(1);
  return opfDir + clean;
}

function isLeafBlock(el: Element): boolean {
  // Skip elements that contain other block-level translatable children;
  // we'll pick up the children directly.
  const inner = el.querySelector(TRANSLATABLE_SELECTOR);
  return !inner;
}

function extractTitle(doc: Document, fallbackHref: string): string {
  for (const tag of ['h1', 'h2', 'h3', 'title']) {
    const el = doc.querySelector(tag);
    const text = el?.textContent?.trim();
    if (text) return text.length > 80 ? text.slice(0, 77) + '…' : text;
  }
  // Fallback to filename without extension
  const name = fallbackHref.split('/').pop() ?? fallbackHref;
  return name.replace(/\.x?html?$/i, '');
}

/**
 * Walk the element, replace math/code/SVG-like inline children with ⟦Mn⟧ placeholders
 * (their outerHTML stashed for later re-insertion), and also replace plain-text $...$
 * and $$...$$ LaTeX runs. Returns the placeholder-stamped text and the preserved chunks.
 */
function extractWithPlaceholders(el: Element): { text: string; preserved: string[] } {
  const preserved: string[] = [];
  // Clone so we don't mutate the live DOM.
  const clone = el.cloneNode(true) as Element;
  const ownerDoc = clone.ownerDocument;
  // Inline elements that should be preserved verbatim — math, code, KaTeX/MathJax wrappers, images.
  const PRESERVE_SELECTOR = 'math, code, svg, img, .MathJax, .math, .katex, [data-math]';
  for (const m of Array.from(clone.querySelectorAll(PRESERVE_SELECTOR))) {
    const placeholder = `⟦M${preserved.length}⟧`;
    preserved.push(m.outerHTML);
    m.replaceWith(ownerDoc.createTextNode(placeholder));
  }
  let text = (clone.textContent ?? '').trim();
  // Preserve $$...$$ first (block math), then $...$ (inline).
  text = text.replace(/\$\$([^$]+)\$\$/g, (_match, inner) => {
    const idx = preserved.length;
    preserved.push(`$$${inner}$$`);
    return `⟦M${idx}⟧`;
  });
  text = text.replace(/\$([^$\n]{1,200})\$/g, (_match, inner) => {
    const idx = preserved.length;
    preserved.push(`$${inner}$`);
    return `⟦M${idx}⟧`;
  });
  return { text, preserved };
}

function extractTranslatableNodes(doc: Document, chapterIndex: number): TranslatableNode[] {
  const out: TranslatableNode[] = [];
  const candidates = Array.from(doc.querySelectorAll(TRANSLATABLE_SELECTOR));
  let counter = 0;
  for (const el of candidates) {
    if (!isLeafBlock(el)) continue;
    const { text, preserved } = extractWithPlaceholders(el);
    if (!text) continue;
    if (text.length < 2) continue; // skip stray punctuation
    if (!text.replace(/⟦M\d+⟧/g, '').trim()) continue; // markup-only block — sibling would duplicate the math/code/img
    const id = `c${chapterIndex}-n${counter++}`;
    el.setAttribute('data-bilingual-id', id);
    out.push({ id, text, preserved });
  }
  return out;
}

export async function parseEpub(file: File | Blob): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(file);

  // Locate OPF via container.xml
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: missing META-INF/container.xml');
  const containerXml = await containerEntry.async('string');
  const containerDoc = parseXml(containerXml, 'application/xml');
  const rootfile = containerDoc.querySelector('rootfile');
  const opfPath = rootfile?.getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid EPUB: container.xml missing rootfile path');

  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB: OPF not found at ${opfPath}`);
  const opfXml = await opfEntry.async('string');
  const opfDoc = parseXml(opfXml, 'application/xml');

  const metadata = readMetadata(opfDoc);

  // Build manifest id -> href map
  const manifestItems = new Map<string, { href: string; mediaType: string }>();
  for (const item of Array.from(opfDoc.querySelectorAll('manifest > item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? '';
    if (id && href) manifestItems.set(id, { href, mediaType });
  }

  // Spine = reading order
  const spineRefs: string[] = [];
  for (const itemref of Array.from(opfDoc.querySelectorAll('spine > itemref'))) {
    const idref = itemref.getAttribute('idref');
    if (idref) spineRefs.push(idref);
  }

  const chapters: ChapterFile[] = [];
  for (let i = 0; i < spineRefs.length; i++) {
    const item = manifestItems.get(spineRefs[i]);
    if (!item) continue;
    if (!item.mediaType.includes('html') && !item.mediaType.includes('xml')) continue;
    const fullPath = resolveHref(opfPath, item.href);
    const entry = zip.file(fullPath);
    if (!entry) continue;
    const raw = await entry.async('string');
    const doc = parseXml(raw, 'application/xhtml+xml');
    const nodes = extractTranslatableNodes(doc, i);
    const title = extractTitle(doc, fullPath);
    chapters.push({ href: fullPath, title, raw, doc, nodes });
  }

  return { zip, opfPath, metadata, chapters };
}

/**
 * Insert translated text after each tagged node.
 * Translations is a Map<nodeId, translatedText>.
 * Nodes without a translation are left untouched.
 */
function restorePlaceholders(text: string, preserved: string[]): string {
  return text.replace(/⟦M(\d+)⟧/g, (_match, idx) => preserved[parseInt(idx, 10)] ?? _match);
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render a placeholder-stamped string as HTML safe for `dangerouslySetInnerHTML`:
 * the prose is escaped, then placeholders are replaced with the raw preserved chunks.
 */
export function renderWithPlaceholders(text: string, preserved: string[]): string {
  return restorePlaceholders(escapeHtmlText(text), preserved);
}

export function applyTranslations(
  chapter: ChapterFile,
  translations: Map<string, string>,
): void {
  for (const node of chapter.nodes) {
    const translated = translations.get(node.id);
    if (!translated) continue;
    const el = chapter.doc.querySelector(`[data-bilingual-id="${node.id}"]`);
    if (!el) continue;
    if (el.parentNode?.querySelector(`[data-bilingual-for="${node.id}"]`)) continue; // already inserted

    const sibling = chapter.doc.createElement(el.tagName.toLowerCase());
    // Copy the original element's class so Kindle renders both with the same font.
    const origClass = el.getAttribute('class') || '';
    sibling.setAttribute('class', origClass);
    sibling.setAttribute('data-bilingual-for', node.id);
    if (node.preserved.length > 0) {
      // Translation contains placeholders — escape the surrounding text but inject
      // the preserved chunks (math/code/etc.) as raw HTML so they render.
      const escaped = escapeHtmlText(translated);
      const markup = restorePlaceholders(escaped, node.preserved);
      try {
        sibling.innerHTML = markup;
      } catch (err) {
        // Strict XML innerHTML rejects named HTML entities, lost xmlns prefixes,
        // and stray '<' from over-eager LaTeX `$...$` capture. Keep the translation
        // and drop the inline markup rather than fail the whole book build.
        console.warn(`[epub] inline markup rejected for ${node.id}, using text fallback`, err);
        sibling.textContent = translated;
      }
    } else {
      sibling.textContent = translated;
    }
    el.parentNode?.insertBefore(sibling, el.nextSibling);
  }
}


// Kindle (and other readers using MathJax-SVG) renders <math> as <svg>, so a
// publisher rule like `svg { height: 98% }` inflates each formula to fill the page.
// We append a higher-specificity override to every CSS file in the EPUB.
const CSS_OVERRIDES = `

/* bilingual translator: prevent publisher svg rules from inflating math */
math svg, mjx-container svg, .MathJax svg, .MathJax_SVG svg,
p svg, blockquote svg, li svg, td svg {
  height: auto !important;
  width: auto !important;
  max-width: 100% !important;
}
`;

async function injectCssOverrides(zip: JSZip): Promise<void> {
  const cssPaths = Object.keys(zip.files).filter(p => p.toLowerCase().endsWith('.css'));
  for (const p of cssPaths) {
    const entry = zip.file(p);
    if (!entry) continue;
    const existing = await entry.async('string');
    if (existing.includes('bilingual translator: prevent publisher svg rules')) continue;
    zip.file(p, existing + CSS_OVERRIDES);
  }
}

export async function buildBilingualEpub(
  parsed: ParsedEpub,
  allTranslations: Map<string, Map<string, string>>, // chapterHref -> nodeId -> translation
  targetLang = 'zh',
): Promise<Blob> {
  // Update OPF language so Kindle uses the correct CJK font for the target language.
  const opfEntry = parsed.zip.file(parsed.opfPath);
  if (opfEntry) {
    let opfXml = await opfEntry.async('string');
    opfXml = opfXml.replace(
      /<dc:language>[^<]*<\/dc:language>/,
      `<dc:language>${targetLang}</dc:language>`,
    );
    parsed.zip.file(parsed.opfPath, opfXml);
  }

  await injectCssOverrides(parsed.zip);

  const failures: Array<{ href: string; message: string }> = [];
  for (const chapter of parsed.chapters) {
    try {
      const chapterTranslations = allTranslations.get(chapter.href);
      if (chapterTranslations) applyTranslations(chapter, chapterTranslations);
      // Set xml:lang on <html> so readers apply the correct font for CJK text.
      const htmlEl = chapter.doc.documentElement;
      htmlEl.setAttribute('xml:lang', targetLang);
      htmlEl.setAttribute('lang', targetLang);
      const updated = serializeXml(chapter.doc);
      parsed.zip.file(chapter.href, updated);
    } catch (e) {
      // One malformed chapter shouldn't bail out the whole export. Synthesize a minimal
      // plain-text XHTML that preserves the translations we already have — readable, even
      // if it loses the publisher's original markup for this chapter.
      failures.push({ href: chapter.href, message: e instanceof Error ? e.message : String(e) });
      const chapterTranslations = allTranslations.get(chapter.href);
      parsed.zip.file(chapter.href, buildPlainTextChapter(chapter, chapterTranslations, targetLang));
    }
  }
  if (failures.length > 0) {
    console.warn(`[epub] ${failures.length} chapter(s) fell back to plain-text on export:`, failures);
  }
  return parsed.zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

/** Minimal XHTML used when normal chapter serialization fails — keeps translations as plain text. */
function buildPlainTextChapter(
  chapter: ChapterFile,
  translations: Map<string, string> | undefined,
  lang: string,
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // Strip ⟦Mn⟧ placeholders; they aren't meant to be reader-visible.
  const clean = (s: string) => s.replace(/⟦M\d+⟧/g, '').replace(/\s+/g, ' ').trim();
  const rows: string[] = [];
  for (const node of chapter.nodes) {
    const orig = clean(node.text);
    if (orig) rows.push(`<p>${esc(orig)}</p>`);
    const tr = translations?.get(node.id);
    const trText = tr ? clean(tr) : '';
    if (trText) rows.push(`<p>${esc(trText)}</p>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head><title>${esc(chapter.title)}</title></head>
<body>
<h1>${esc(chapter.title)}</h1>
${rows.join('\n')}
</body>
</html>`;
}

/** Render a small HTML preview of bilingual content (first N nodes). */
export function renderPreviewHtml(
  chapter: ChapterFile,
  translations: Map<string, string>,
  limit = 20,
): string {
  const items = chapter.nodes.slice(0, limit);
  return items
    .map(node => {
      const translated = translations.get(node.id);
      const orig = escapeHtml(node.text);
      const tr = translated ? escapeHtml(translated) : '<em style="opacity:.4">(pending)</em>';
      return `<div class="bi-block"><p class="bi-orig">${orig}</p><p class="bi-tr">${tr}</p></div>`;
    })
    .join('');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
