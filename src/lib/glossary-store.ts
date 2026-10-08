// User-managed glossary library — stored in its own IndexedDB so the ebook-session
// schema doesn't need a version bump every time we extend either side.

const DB_NAME = 'ebook-glossaries';
const DB_VERSION = 1;
const STORE_NAME = 'glossaries';
const MAX_GLOSSARIES = 50;

export interface GlossaryEntry {
  source: string;
  target: string;
  /** Optional clarifier shown to the LLM (e.g. "framework, not season"). */
  note?: string;
}

export interface PersistedGlossary {
  id: string;
  name: string;
  entries: GlossaryEntry[];
  createdAt: number;
}

export interface GlossarySummary {
  id: string;
  name: string;
  entryCount: number;
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open glossary database'));
  });
  return dbPromise;
}

function runRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function summarize(r: PersistedGlossary): GlossarySummary {
  return { id: r.id, name: r.name, entryCount: r.entries.length, createdAt: r.createdAt };
}

export async function listGlossaries(): Promise<GlossarySummary[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records = await runRequest(store.getAll() as IDBRequest<PersistedGlossary[]>);
  return records.map(summarize).sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadGlossary(id: string): Promise<PersistedGlossary | null> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const record = await runRequest(
    store.get(id) as IDBRequest<PersistedGlossary | undefined>,
  );
  return record ?? null;
}

export async function saveGlossary(params: {
  name: string;
  entries: GlossaryEntry[];
}): Promise<PersistedGlossary> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const record: PersistedGlossary = {
    id: generateId(),
    name: params.name,
    entries: params.entries,
    createdAt: Date.now(),
  };
  store.put(record);
  // Trim oldest if we cross MAX_GLOSSARIES — same LRU-by-creation logic the
  // session store uses, just simpler since glossaries don't track access time.
  const all = await runRequest(store.getAll() as IDBRequest<PersistedGlossary[]>);
  const candidates = all
    .filter(r => r.id !== record.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  while (candidates.length + 1 > MAX_GLOSSARIES) {
    const oldest = candidates.shift();
    if (!oldest) break;
    store.delete(oldest.id);
  }
  await txDone(tx);
  return record;
}

export async function deleteGlossary(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(id);
  await txDone(tx);
}

// CSV parsing ------------------------------------------------------------

const HEADER_TOKENS = new Set([
  'source', 'target', 'term', 'translation', 'note', 'notes',
  '原文', '译文', '翻译', '术语', '备注',
  'src', 'tgt', 'from', 'to',
]);

/**
 * Parse a CSV/TSV string into glossary entries. Supports:
 *   - Two-column (source,target) or three-column (source,target,note) rows.
 *   - Comma OR tab as separator — auto-detected per row.
 *   - Quoted fields with embedded commas and "" escapes.
 *   - Blank lines and comment lines (starting with #) are ignored.
 *   - An optional header row, auto-detected by checking the first cell against
 *     a small set of common header words.
 *
 * Throws a human-readable Error if no usable rows survive parsing.
 */
export function parseCsvGlossary(text: string): GlossaryEntry[] {
  // Normalize line endings and strip the optional BOM that Windows Excel writes.
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const rawRows = parseCsvRows(normalized);
  if (rawRows.length === 0) throw new Error('CSV is empty');

  let startIdx = 0;
  // Skip a header row only if the first cell clearly looks like a header token
  // — otherwise users with English source terms like "source code" lose their first row.
  const firstFirstCell = rawRows[0][0]?.trim().toLowerCase() ?? '';
  if (HEADER_TOKENS.has(firstFirstCell)) startIdx = 1;

  const out: GlossaryEntry[] = [];
  const seen = new Set<string>();
  for (let i = startIdx; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (row.length === 0) continue;
    const source = (row[0] ?? '').trim();
    const target = (row[1] ?? '').trim();
    if (!source || !target) continue;
    // First-wins dedup so reuploading the same file isn't punished.
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const note = (row[2] ?? '').trim();
    out.push(note ? { source, target, note } : { source, target });
  }
  if (out.length === 0) throw new Error('No valid source,target rows found in CSV');
  return out;
}

/** RFC-4180-ish row parser. Auto-detects comma vs tab per line. */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let sep: ',' | '\t' = ','; // sticky per-document; first non-quoted separator wins.
  let sepDetected = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      inQuotes = true;
      continue;
    }
    if (!sepDetected && (ch === ',' || ch === '\t')) {
      sep = ch;
      sepDetected = true;
    }
    if (ch === sep) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      cell = '';
      // Skip blank lines and lines that start with '#' (after trim).
      const first = row[0]?.trim() ?? '';
      if (!(row.length === 1 && first === '') && !first.startsWith('#')) {
        rows.push(row);
      }
      row = [];
      continue;
    }
    cell += ch;
  }
  // Flush trailing row (file without final newline).
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    const first = row[0]?.trim() ?? '';
    if (!(row.length === 1 && first === '') && !first.startsWith('#')) {
      rows.push(row);
    }
  }
  return rows;
}

export { generateId as newGlossaryId };
