/**
 * IndexedDB-backed store for document file data (base64 data URLs).
 *
 * localStorage has a ~5MB quota — storing even one scanned PDF as a
 * data URL blows past it and throws QuotaExceededError. IndexedDB has
 * a much larger budget (hundreds of MB) and is the correct place for
 * binary-ish blobs.
 *
 * The store is keyed by document id. File data is kept in memory by
 * React state (so the UI renders instantly) and mirrored here so it
 * survives page reloads.
 */

const DB_NAME = "lifevault-files";
const STORE_NAME = "files";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this environment"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Save file data for a document. No-op if data is null/empty. */
export async function saveFileData(docId: string, data: string | null | undefined): Promise<void> {
  if (!data) return;
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(data, docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal — file data stays in memory for this session.
  }
}

/** Load file data for a document. Returns null if not found. */
export async function loadFileData(docId: string): Promise<string | null> {
  try {
    const db = await openDB();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(docId);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

/** Load all file data as a Map keyed by document id. */
export async function loadAllFileData(): Promise<Map<string, string>> {
  try {
    const db = await openDB();
    return await new Promise<Map<string, string>>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      const result = new Map<string, string>();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (typeof cursor.value === "string") {
            result.set(cursor.key as string, cursor.value);
          }
          cursor.continue();
        } else {
          resolve(result);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return new Map();
  }
}

/** Remove file data for a document (called on delete). */
export async function deleteFileData(docId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(docId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}

/** Remove file data for all documents not in the given set of ids. */
export async function pruneFileData(validIds: Set<string>): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          if (!validIds.has(cursor.key as string)) {
            cursor.delete();
          }
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Non-fatal
  }
}
