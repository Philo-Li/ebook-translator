const DB_NAME = 'ebook-translator';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const LEGACY_ACTIVE_KEY = 'active';
const MAX_SESSIONS = 10;

export interface PersistedSinglePageItem {
  type: string;
  original: string;
  translated: string;
}

export interface PersistedSinglePageResult {
  pageIndex: number;
  items: PersistedSinglePageItem[];
}

export interface PersistedNodeError {
  nodeId: string;
  message: string;
}

export interface PersistedEbookSessionSnapshot {
  version: 1;
  sourceKind: 'epub' | 'pdf-preview' | 'pdf-text' | 'pdf-ocr' | null;
  step: 'settings' | 'upload' | 'browse';
  fileName: string | null;
  fileType: string | null;
  selectedIdx: number;
  previewPage: number;
  sidebarCollapsed: boolean;
  pdfMeta: { pageCount: number; isScanned: boolean } | null;
  parseError: string | null;
  chapterStatus: Array<[string, string]>;
  allTranslations: Array<[string, Array<[string, string]>]>;
  chapterErrors: Array<[string, PersistedNodeError[]]>;
  pagePhase: Array<[number, string]>;
  pageResults: Array<[number, PersistedSinglePageResult]>;
  pageErrors: Array<[number, string]>;
  // Totals are denormalized so the history list can show progress without
  // re-parsing the source file. Optional because legacy records pre-history
  // did not write them.
  totalNodes?: number;
  totalPages?: number;
  /** ID of the user's glossary attached to this book, or null/undefined when none. */
  selectedGlossaryId?: string | null;
}

interface PersistedEbookSessionRecord {
  id: string;
  snapshot: PersistedEbookSessionSnapshot;
  fileBlob: Blob | null;
  parsedBlob: Blob | null;
  lastOpenedAt: number;
  fileName: string | null;
  fileSize: number;
  fileType: string | null;
}

export interface LoadedEbookSession {
  id: string;
  snapshot: PersistedEbookSessionSnapshot;
  fileBlob: Blob | null;
  parsedBlob: Blob | null;
}

export interface EbookSessionSummary {
  id: string;
  fileName: string | null;
  fileSize: number;
  fileType: string | null;
  sourceKind: PersistedEbookSessionSnapshot['sourceKind'];
  lastOpenedAt: number;
  translatedNodes: number;
  totalNodes: number;
  donePages: number;
  totalPages: number;
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
    req.onerror = () => reject(req.error ?? new Error('Failed to open ebook session database'));
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
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

let migrationPromise: Promise<void> | null = null;

/**
 * One-shot migration for users who had the pre-history single-session schema
 * (record keyed by 'active'). Converts it into a normal history entry so the
 * book and its translations are not lost when the new code first loads.
 */
async function migrateLegacyActiveRecord(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const legacy = await runRequest(
    store.get(LEGACY_ACTIVE_KEY) as IDBRequest<PersistedEbookSessionRecord | undefined>,
  );
  if (!legacy) return;
  const id = generateId();
  const fileBlob = legacy.fileBlob ?? null;
  const migrated: PersistedEbookSessionRecord = {
    id,
    snapshot: legacy.snapshot,
    fileBlob,
    parsedBlob: legacy.parsedBlob ?? null,
    lastOpenedAt: typeof legacy.lastOpenedAt === 'number' ? legacy.lastOpenedAt : Date.now(),
    fileName: legacy.snapshot?.fileName ?? null,
    fileSize: fileBlob?.size ?? 0,
    fileType: legacy.snapshot?.fileType ?? fileBlob?.type ?? null,
  };
  store.put(migrated);
  store.delete(LEGACY_ACTIVE_KEY);
  await txDone(tx);
}

function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = migrateLegacyActiveRecord().catch(err => {
      console.warn('[ebook-session] legacy migration failed', err);
    });
  }
  return migrationPromise;
}

function summarize(r: PersistedEbookSessionRecord): EbookSessionSummary {
  let translatedNodes = 0;
  for (const [, entries] of r.snapshot.allTranslations) translatedNodes += entries.length;
  const donePages = r.snapshot.pagePhase.reduce((n, [, phase]) => (phase === 'done' ? n + 1 : n), 0);
  return {
    id: r.id,
    fileName: r.fileName,
    fileSize: r.fileSize,
    fileType: r.fileType,
    sourceKind: r.snapshot.sourceKind,
    lastOpenedAt: r.lastOpenedAt,
    translatedNodes,
    totalNodes: r.snapshot.totalNodes ?? translatedNodes,
    donePages,
    totalPages: r.snapshot.totalPages ?? r.snapshot.pdfMeta?.pageCount ?? 0,
  };
}

export async function listEbookSessions(): Promise<EbookSessionSummary[]> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records = await runRequest(store.getAll() as IDBRequest<PersistedEbookSessionRecord[]>);
  return records
    .filter(r => r.id !== LEGACY_ACTIVE_KEY)
    .map(summarize)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function loadMostRecentSession(): Promise<LoadedEbookSession | null> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records = await runRequest(store.getAll() as IDBRequest<PersistedEbookSessionRecord[]>);
  const usable = records.filter(r => r.id !== LEGACY_ACTIVE_KEY);
  if (usable.length === 0) return null;
  usable.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const r = usable[0];
  return { id: r.id, snapshot: r.snapshot, fileBlob: r.fileBlob, parsedBlob: r.parsedBlob };
}

export async function loadEbookSession(id: string): Promise<LoadedEbookSession | null> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const record = await runRequest(
    store.get(id) as IDBRequest<PersistedEbookSessionRecord | undefined>,
  );
  if (!record) return null;
  return { id: record.id, snapshot: record.snapshot, fileBlob: record.fileBlob, parsedBlob: record.parsedBlob };
}

export async function findSessionByFile(fileName: string, fileSize: number): Promise<string | null> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const records = await runRequest(store.getAll() as IDBRequest<PersistedEbookSessionRecord[]>);
  const match = records.find(r => r.id !== LEGACY_ACTIVE_KEY && r.fileName === fileName && r.fileSize === fileSize);
  return match ? match.id : null;
}

export interface SaveSessionParams {
  id: string;
  snapshot: PersistedEbookSessionSnapshot;
  fileBlob: Blob | null;
  parsedBlob: Blob | null;
  fileName: string | null;
  fileSize: number;
  fileType: string | null;
}

export async function saveEbookSession(params: SaveSessionParams): Promise<void> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const record: PersistedEbookSessionRecord = {
    id: params.id,
    snapshot: params.snapshot,
    fileBlob: params.fileBlob,
    parsedBlob: params.parsedBlob,
    lastOpenedAt: Date.now(),
    fileName: params.fileName,
    fileSize: params.fileSize,
    fileType: params.fileType,
  };
  store.put(record);
  // LRU prune: keep at most MAX_SESSIONS records (excluding the legacy key, which
  // will be cleaned up by migration on next read).
  const all = await runRequest(store.getAll() as IDBRequest<PersistedEbookSessionRecord[]>);
  const candidates = all
    .filter(r => r.id !== LEGACY_ACTIVE_KEY && r.id !== params.id)
    .sort((a, b) => a.lastOpenedAt - b.lastOpenedAt);
  while (candidates.length + 1 > MAX_SESSIONS) {
    const oldest = candidates.shift();
    if (!oldest) break;
    store.delete(oldest.id);
  }
  await txDone(tx);
}

export async function deleteEbookSession(id: string): Promise<void> {
  await ensureMigrated();
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(id);
  await txDone(tx);
}

export { generateId as newEbookSessionId };
