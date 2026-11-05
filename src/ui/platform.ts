import { errorData, log } from '../core/log';

// Files and storage, in one place: where work is saved and how files are opened.
//
// - In Chrome and Edge (the File System Access API) the writer saves to real files: Save writes
//   back to the project file it came from, Save As and exports open the system's Save dialog
//   (each kind of export remembers its folder), and recently used project files can be reopened.
// - Elsewhere (Safari, Firefox, the file:// edition in some browsers) files are downloads and
//   opened through the file picker, as before.
// - The autosaved project lives in IndexedDB, which allows far more than localStorage's ~5 MB.
//
// A desktop edition could implement this same module with native dialogs (see the README).

const platformLog = log('files');

// ---------------------------------------------------------------------------------------------
// File System Access API (Chromium). Typed loosely: TypeScript's DOM library doesn't include it.

export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | BufferSource | string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
type PickerType = { description: string; accept: Record<string, string[]> };
type Picker = {
  showSaveFilePicker?(o: { suggestedName?: string; id?: string; types?: PickerType[] }): Promise<FileHandle>;
  showOpenFilePicker?(o: { id?: string; types?: PickerType[]; multiple?: boolean }): Promise<FileHandle[]>;
};
const picker = (): Picker => (typeof window === 'undefined' ? {} : (window as unknown as Picker));

/** Whether this browser can save to and reopen real files (Chrome, Edge, Opera on computers and Chromebooks). */
export function canUseFiles(): boolean {
  const w = picker();
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
}

export const PROJECT_TYPE: PickerType = { description: 'Narrative Bridge project', accept: { 'application/json': ['.json'] } };

const TYPES: Record<string, PickerType> = {
  html: { description: 'Web page', accept: { 'text/html': ['.html'] } },
  zip: { description: 'Zip archive', accept: { 'application/zip': ['.zip'] } },
  ink: { description: 'Ink story', accept: { 'text/plain': ['.ink'] } },
  json: { description: 'JSON', accept: { 'application/json': ['.json'] } },
  twee: { description: 'Twine story', accept: { 'text/plain': ['.twee'] } },
  csv: { description: 'Spreadsheet (CSV)', accept: { 'text/csv': ['.csv'] } },
  svg: { description: 'SVG image', accept: { 'image/svg+xml': ['.svg'] } },
  png: { description: 'PNG image', accept: { 'image/png': ['.png'] } },
  txt: { description: 'Text', accept: { 'text/plain': ['.txt'] } },
  jpg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  jpeg: { description: 'JPEG image', accept: { 'image/jpeg': ['.jpg', '.jpeg'] } },
  wav: { description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } },
  mp3: { description: 'MP3 audio', accept: { 'audio/mpeg': ['.mp3'] } },
  ogg: { description: 'Ogg audio', accept: { 'audio/ogg': ['.ogg'] } },
  fountain: { description: 'Fountain screenplay', accept: { 'text/plain': ['.fountain'] } },
  md: { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
  tgz: { description: 'Unity package (tarball)', accept: { 'application/gzip': ['.tgz'] } },
};

const isAbort = (e: unknown) => (e as { name?: string })?.name === 'AbortError';

/** Writes data to a file the writer picked earlier, asking again for permission if the browser needs it. */
export async function writeToHandle(handle: FileHandle, data: string | Uint8Array): Promise<void> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if (!handle.requestPermission || (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Permission to save to this file was not given.');
  }
  const w = await handle.createWritable();
  await w.write(data as Blob | string);
  await w.close();
}

/** The old way: a download into the browser's downloads folder. */
export function downloadFile(name: string, data: string | Uint8Array, type = 'text/plain') {
  const blob = new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves a file where the writer chooses (Save dialog) when the browser allows it, else downloads
 * it. Returns the file it was saved to, 'downloaded', or null if the writer cancelled.
 */
export async function saveFile(name: string, data: string | Uint8Array, type = 'text/plain', kind?: string): Promise<FileHandle | 'downloaded' | null> {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'txt').toLowerCase();
  const show = picker().showSaveFilePicker;
  if (canUseFiles() && show) {
    try {
      const handle = await show({ suggestedName: name, id: kind ?? `export-${ext}`, types: [kind === 'project' ? PROJECT_TYPE : (TYPES[ext] ?? TYPES.txt)] });
      await writeToHandle(handle, data);
      platformLog.info('Saved a file', { kind: kind ?? ext, bytes: typeof data === 'string' ? data.length : data.byteLength });
      return handle;
    } catch (e) {
      if (isAbort(e)) return null;
      // No user gesture left, or the browser refused: fall back to a download rather than lose the file.
      platformLog.warn('Save dialog unavailable; downloading instead', errorData(e));
    }
  }
  downloadFile(name, data, type);
  return 'downloaded';
}

/** Lets the writer pick a project file to open. Null if cancelled or the browser can't (use the file input then). */
export async function pickProjectFile(): Promise<{ file: File; handle: FileHandle } | null> {
  const show = picker().showOpenFilePicker;
  if (!canUseFiles() || !show) return null;
  try {
    const [handle] = await show({ id: 'project', types: [PROJECT_TYPE] });
    return { file: await handle.getFile(), handle };
  } catch (e) {
    if (!isAbort(e)) platformLog.warn('Open dialog unavailable', errorData(e));
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// A small IndexedDB key-value store: the autosaved project and the recent project files.

const DB = 'narrative-bridge-store';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------------------------
// Recent project files (Chromium: file handles can be kept and reopened with permission).

export interface RecentFile {
  name: string;
  title: string;
  openedAt: number;
  handle: FileHandle;
}

const RECENT = 'recent-files';
const RECENT_MAX = 8;

export async function listRecent(): Promise<RecentFile[]> {
  if (!canUseFiles()) return [];
  try {
    return (await kvGet<RecentFile[]>(RECENT)) ?? [];
  } catch {
    return [];
  }
}

export async function rememberRecent(handle: FileHandle, title: string): Promise<void> {
  if (!canUseFiles()) return;
  try {
    const list = await listRecent();
    const others: RecentFile[] = [];
    for (const r of list) {
      const same = await (r.handle as unknown as { isSameEntry?(o: FileHandle): Promise<boolean> }).isSameEntry?.(handle).catch(() => false);
      if (!same) others.push(r);
    }
    await kvSet(RECENT, [{ name: handle.name, title, openedAt: Date.now(), handle }, ...others].slice(0, RECENT_MAX));
  } catch (e) {
    platformLog.warn('Could not remember a recent file', errorData(e));
  }
}

export async function forgetRecent(handle: FileHandle): Promise<void> {
  const list = await listRecent();
  const keep: RecentFile[] = [];
  for (const r of list) if (!(await (r.handle as unknown as { isSameEntry?(o: FileHandle): Promise<boolean> }).isSameEntry?.(handle).catch(() => false))) keep.push(r);
  await kvSet(RECENT, keep);
}

/** Reopens a recent file, asking the browser for permission again if needed. */
export async function readRecent(r: RecentFile): Promise<File> {
  if (r.handle.queryPermission && (await r.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    const p = await r.handle.requestPermission?.({ mode: 'readwrite' });
    if (p !== 'granted' && (await r.handle.queryPermission({ mode: 'read' })) !== 'granted') throw new Error('Permission to open this file was not given.');
  }
  return r.handle.getFile();
}

// ---------------------------------------------------------------------------------------------
// Keeping the browser from clearing the app's storage.

/** Asks the browser to keep this site's storage (Chrome/Edge usually agree, Firefox asks, Safari decides). */
export async function requestPersistence(): Promise<boolean | null> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return null;
  try {
    if (await storage.persisted()) return true;
    const granted = await storage.persist();
    platformLog.info('Asked the browser to keep this app’s storage', { granted });
    return granted;
  } catch {
    return null;
  }
}

/** How full the browser's storage for this app is (0–1), if the browser says. */
export async function storageUse(): Promise<number | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e?.usage !== undefined && e.quota ? e.usage / e.quota : null;
  } catch {
    return null;
  }
}
