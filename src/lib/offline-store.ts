import { openDB, type IDBPDatabase } from "idb";

// IndexedDB schema for offline mode.
// - pending_sessions:  full session payload waiting to be inserted server-side
// - pending_plates:    detected_plates rows waiting on their session upload
// - plates_cache:      snapshot of the user's plate DB for offline matching
// - meta:              small key/value (last sync timestamp, cache owner, etc.)

const DB_NAME = "plate-offline-v1";
const DB_VERSION = 1;

export interface PendingSession {
  client_id: string;
  user_id: string;
  payload: Record<string, unknown>;
  created_at: number;
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
}

export interface PendingPlate {
  client_id: string;             // per-plate client id (== entry.id from UI)
  session_client_id: string;     // links to PendingSession.client_id until we get a server session_id
  user_id: string;
  payload: Record<string, unknown>;
  created_at: number;
  attempts: number;
  last_error?: string;
  next_retry_at?: number;
}

export interface CachedPlate {
  id: string;
  plate_raw: string;
  plate_normalized: string;
  bank: string | null;
  car_type: string | null;
  chassis: string | null;
  plate_date: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  if (typeof indexedDB === "undefined") throw new Error("IndexedDB unavailable");
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("pending_sessions")) {
          db.createObjectStore("pending_sessions", { keyPath: "client_id" });
        }
        if (!db.objectStoreNames.contains("pending_plates")) {
          const s = db.createObjectStore("pending_plates", { keyPath: "client_id" });
          s.createIndex("by_session", "session_client_id");
        }
        if (!db.objectStoreNames.contains("plates_cache")) {
          const s = db.createObjectStore("plates_cache", { keyPath: "id" });
          s.createIndex("by_normalized", "plate_normalized");
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
      },
    });
  }
  return dbPromise;
}

export function isIndexedDBAvailable() {
  return typeof indexedDB !== "undefined";
}

// -------- pending queue ----------

export async function enqueueSession(s: PendingSession) {
  const d = await db();
  await d.put("pending_sessions", s);
}

export async function enqueuePlate(p: PendingPlate) {
  const d = await db();
  await d.put("pending_plates", p);
}

export async function enqueuePlates(list: PendingPlate[]) {
  if (list.length === 0) return;
  const d = await db();
  const tx = d.transaction("pending_plates", "readwrite");
  for (const p of list) await tx.store.put(p);
  await tx.done;
}

export async function listPendingSessions(): Promise<PendingSession[]> {
  const d = await db();
  return (await d.getAll("pending_sessions")) as PendingSession[];
}

export async function listPendingPlatesFor(sessionClientId: string): Promise<PendingPlate[]> {
  const d = await db();
  return (await d.getAllFromIndex("pending_plates", "by_session", sessionClientId)) as PendingPlate[];
}

export async function listAllPendingPlates(): Promise<PendingPlate[]> {
  const d = await db();
  return (await d.getAll("pending_plates")) as PendingPlate[];
}

export async function deleteSession(clientId: string) {
  const d = await db();
  await d.delete("pending_sessions", clientId);
}

export async function deletePlate(clientId: string) {
  const d = await db();
  await d.delete("pending_plates", clientId);
}

export async function deletePlatesFor(sessionClientId: string) {
  const d = await db();
  const tx = d.transaction("pending_plates", "readwrite");
  const idx = tx.store.index("by_session");
  let cursor = await idx.openCursor(IDBKeyRange.only(sessionClientId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** Exponential backoff with full jitter: 5s, 15s, 45s, 2m, 6m, capped at 15m. */
export function computeBackoffMs(attempts: number): number {
  const base = 5_000;
  const cap = 15 * 60_000;
  const exp = Math.min(cap, base * Math.pow(3, Math.max(0, attempts - 1)));
  return Math.floor(Math.random() * exp);
}

export async function bumpAttempt(store: "pending_sessions" | "pending_plates", clientId: string, err: string) {
  const d = await db();
  const item = (await d.get(store, clientId)) as PendingSession | PendingPlate | undefined;
  if (!item) return;
  item.attempts = (item.attempts ?? 0) + 1;
  item.last_error = err.slice(0, 200);
  item.next_retry_at = Date.now() + computeBackoffMs(item.attempts);
  await d.put(store, item);
}

/** Reset backoff for all pending items (used when connectivity flips online). */
export async function resetBackoff() {
  const d = await db();
  for (const store of ["pending_sessions", "pending_plates"] as const) {
    const tx = d.transaction(store, "readwrite");
    let cursor = await tx.store.openCursor();
    while (cursor) {
      const v = cursor.value as PendingSession | PendingPlate;
      if (v.next_retry_at) { v.next_retry_at = 0; await cursor.update(v); }
      cursor = await cursor.continue();
    }
    await tx.done;
  }
}

/** Timestamp (ms) of the earliest pending retry, or null if the queue is empty. */
export async function earliestNextRetryAt(): Promise<number | null> {
  if (!isIndexedDBAvailable()) return null;
  const d = await db();
  let earliest: number | null = null;
  for (const store of ["pending_sessions", "pending_plates"] as const) {
    const items = (await d.getAll(store)) as Array<PendingSession | PendingPlate>;
    for (const it of items) {
      const t = it.next_retry_at ?? 0;
      if (earliest === null || t < earliest) earliest = t;
    }
  }
  return earliest;
}

export async function pendingCounts(): Promise<{ sessions: number; plates: number }> {
  if (!isIndexedDBAvailable()) return { sessions: 0, plates: 0 };
  const d = await db();
  const [s, p] = await Promise.all([d.count("pending_sessions"), d.count("pending_plates")]);
  return { sessions: s, plates: p };
}

// -------- plates cache (offline matching) ----------

export async function cachePlates(userId: string, list: CachedPlate[]) {
  const d = await db();
  const tx = d.transaction(["plates_cache", "meta"], "readwrite");
  await tx.objectStore("plates_cache").clear();
  const store = tx.objectStore("plates_cache");
  for (const p of list) await store.put(p);
  await tx.objectStore("meta").put({ user_id: userId, count: list.length, at: Date.now() }, "plates_cache_info");
  await tx.done;
}

export async function getCachedPlateByNormalized(normalized: string): Promise<CachedPlate | null> {
  if (!isIndexedDBAvailable()) return null;
  const d = await db();
  const rec = await d.getFromIndex("plates_cache", "by_normalized", normalized);
  return (rec as CachedPlate | undefined) ?? null;
}

export async function platesCacheInfo(): Promise<{ user_id: string; count: number; at: number } | null> {
  if (!isIndexedDBAvailable()) return null;
  const d = await db();
  const rec = await d.get("meta", "plates_cache_info");
  return (rec as { user_id: string; count: number; at: number } | undefined) ?? null;
}

export async function setMeta(key: string, value: unknown) {
  const d = await db();
  await d.put("meta", value, key);
}

export async function getMeta<T = unknown>(key: string): Promise<T | null> {
  if (!isIndexedDBAvailable()) return null;
  const d = await db();
  return ((await d.get("meta", key)) as T | undefined) ?? null;
}
