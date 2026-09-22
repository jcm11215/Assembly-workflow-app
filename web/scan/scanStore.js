/**
 * Durable store for finished scan layers.
 *
 * A scan is a set of independent readings of the same sheets. Each one
 * that succeeds is an answer about a specific page, asked in a specific
 * way -- and that answer does not change unless the page changes or the
 * question changes. So it is keyed by exactly those two things and kept,
 * which makes a retry cost only the readings still missing.
 *
 * IndexedDB rather than localStorage: replies run to tens of kilobytes,
 * localStorage is a few megabytes shared with everything else and its
 * writes block the main thread. Everything degrades to an in-memory map
 * when IndexedDB is unavailable -- a private window, a locked-down
 * browser -- because a scan that cannot cache is worse than slow, while
 * a scan that cannot run is broken.
 */

const DB_NAME = 'awt-scan-layers';
const STORE = 'layers';
const DB_VERSION = 1;
// Long enough to cover "it failed, I'll come back to it tomorrow", short
// enough that a drawing revised next month is read fresh.
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Used when IndexedDB is unavailable, and as the read-through cache in
 *  front of it so a repeated lookup within one scan costs nothing. */
const memory = new Map();

let dbPromise = null;
function openDb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { return resolve(null); }            // blocked entirely
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const os = db.createObjectStore(STORE, { keyPath: 'key' });
        os.createIndex('at', 'at');            // for age eviction
      }
    };
    req.onsuccess = () => resolve(req.result);
    // A private window, a full disk, a browser with storage disabled:
    // all land here, and all mean "run without a cache", not "fail".
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  }).catch(() => null);
  return dbPromise;
}

function tx(db, mode){
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * A fast, non-cryptographic hash of a page's bytes (cyrb53).
 *
 * This decides whether a cached answer belongs to the page in front of
 * us, so it reads every character rather than sampling: two revisions of
 * the same drawing differ somewhere in the middle, and a sampled key
 * would hand back last revision's parts list for this revision's sheet.
 * Not a security boundary -- nobody is constructing a collision -- so a
 * cheap hash beats waiting on SubtleCrypto for every page.
 */
export function hashContent(str){
  const s = String(str == null ? '' : str);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0; i < s.length; i++){
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  // Length included so two strings that hash alike but differ in size
  // cannot collide.
  return `${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}-${s.length.toString(36)}`;
}

/**
 * The key for one finished reading.
 *
 * @param question     which reading this is ('parts', 'callouts', ...)
 * @param promptVersion bumped whenever that question's wording changes --
 *                      without it, a reworded prompt would keep serving
 *                      answers to the question it used to ask, which is
 *                      the worst kind of stale: invisible and confident.
 * @param pageHashes   the pages this reading covered, in page order
 */
export function layerKey(question, promptVersion, pageHashes){
  return `${question}@${promptVersion}#${(pageHashes || []).join(',')}`;
}

/** The stored answer, or undefined. Never throws: a cache that is
 *  misbehaving must not take the scan with it. */
export async function readLayer(key){
  if(memory.has(key)) return memory.get(key);
  const db = await openDb();
  if(!db) return undefined;
  try {
    const row = await new Promise((resolve, reject) => {
      const r = tx(db, 'readonly').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    if(!row) return undefined;
    if(Date.now() - row.at > MAX_AGE_MS){ deleteLayer(key); return undefined; }
    memory.set(key, row.value);
    return row.value;
  } catch { return undefined; }
}

/** Stores one finished reading. Fire and forget -- a scan must not wait
 *  on, or fail because of, a cache write. */
export function writeLayer(key, value, meta){
  memory.set(key, value);
  openDb().then(db => {
    if(!db) return;
    try { tx(db, 'readwrite').put({ key, value, at: Date.now(), ...(meta || {}) }); }
    catch { /* quota, or the store vanished mid-session */ }
  }).catch(() => {});
}

export function deleteLayer(key){
  memory.delete(key);
  openDb().then(db => { if(db){ try { tx(db, 'readwrite').delete(key); } catch {} } }).catch(() => {});
}

/**
 * Drops every reading of the given pages, whatever question was asked.
 *
 * This is what "Re-Scan" means: read the sheet again rather than replay
 * the last answer, which is the only reason anyone taps it.
 */
export async function forgetPages(pageHashes){
  const wanted = new Set(pageHashes || []);
  for(const key of [...memory.keys()]){
    if([...wanted].some(h => key.includes(h))) memory.delete(key);
  }
  const db = await openDb();
  if(!db) return;
  try {
    const store = tx(db, 'readwrite');
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if(!cur) return;
      if([...wanted].some(h => String(cur.key).includes(h))) cur.delete();
      cur.continue();
    };
  } catch { /* nothing to clean up */ }
}

/** Removes entries past their age. Called once per scan; cheap, and it
 *  keeps a long-lived browser profile from growing without bound. */
export async function evictOld(){
  const db = await openDb();
  if(!db) return;
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    const req = tx(db, 'readwrite').index('at').openCursor(IDBKeyRange.upperBound(cutoff));
    req.onsuccess = () => {
      const cur = req.result;
      if(!cur) return;
      memory.delete(cur.value.key);
      cur.delete();
      cur.continue();
    };
  } catch { /* not worth reporting */ }
}

/** Test seam. */
export function clearMemoryLayers(){ memory.clear(); }
