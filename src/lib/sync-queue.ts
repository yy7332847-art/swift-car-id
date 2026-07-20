import { supabase } from "@/integrations/supabase/client";
import {
  bumpAttempt,
  deletePlate,
  deletePlatesFor,
  deleteSession,
  earliestNextRetryAt,
  listAllPendingPlates,
  listPendingPlatesFor,
  listPendingSessions,
  pendingCounts,
  resetBackoff,
  setMeta,
  cachePlates,
  type CachedPlate,
} from "./offline-store";

type SyncListener = (state: SyncState) => void;

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pendingSessions: number;
  pendingPlates: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

const state: SyncState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pendingSessions: 0,
  pendingPlates: 0,
  lastSyncAt: null,
  lastError: null,
};

const listeners = new Set<SyncListener>();
let started = false;
let intervalId: ReturnType<typeof setInterval> | null = null;

function notify() {
  for (const l of listeners) l({ ...state });
}

export function subscribeSync(l: SyncListener): () => void {
  listeners.add(l);
  l({ ...state });
  return () => listeners.delete(l);
}

export function getSyncState(): SyncState {
  return { ...state };
}

async function refreshCounts() {
  try {
    const c = await pendingCounts();
    state.pendingSessions = c.sessions;
    state.pendingPlates = c.plates;
    notify();
  } catch {
    /* IndexedDB unavailable — leave zero */
  }
}

export async function syncNow(): Promise<{ pushed: number; failed: number }> {
  if (state.syncing) return { pushed: 0, failed: 0 };
  if (!(typeof navigator === "undefined" ? true : navigator.onLine)) {
    state.online = false;
    notify();
    return { pushed: 0, failed: 0 };
  }
  state.syncing = true;
  state.lastError = null;
  notify();

  let pushed = 0;
  let failed = 0;

  try {
    const sessions = await listPendingSessions();
    // Map from a session's client_id → server-assigned session id.
    const sessionServerIds = new Map<string, string>();

    for (const s of sessions) {
      try {
        // Upsert by (user_id, client_id) unique index.
        const { data, error } = await supabase
          .from("recognition_sessions")
          .upsert({ ...s.payload, client_id: s.client_id, user_id: s.user_id } as unknown as never, { onConflict: "user_id,client_id" })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("upsert failed");
        sessionServerIds.set(s.client_id, data.id as string);

        // Push all plates linked to this session in one batch.
        const plates = await listPendingPlatesFor(s.client_id);
        if (plates.length > 0) {
          const rows = plates.map((p) => ({
            ...p.payload,
            session_id: data.id,
            user_id: p.user_id,
            client_id: p.client_id,
          }));
          const { error: pErr } = await supabase
            .from("detected_plates")
            .upsert(rows as unknown as never, { onConflict: "user_id,client_id" });
          if (pErr) throw pErr;
          await deletePlatesFor(s.client_id);
          pushed += plates.length;
        }
        await deleteSession(s.client_id);
        pushed += 1;
      } catch (err) {
        failed += 1;
        await bumpAttempt("pending_sessions", s.client_id, err instanceof Error ? err.message : String(err));
      }
    }

    // Orphan plates: session was already saved server-side but plates weren't (e.g. partial success).
    // Their payload should already carry a valid session_id.
    const orphanPlates = (await listAllPendingPlates()).filter((p) => !sessions.find((s) => s.client_id === p.session_client_id));
    if (orphanPlates.length > 0) {
      const bySession = new Map<string, typeof orphanPlates>();
      for (const p of orphanPlates) {
        const key = String(p.payload.session_id ?? "");
        if (!key) { await deletePlate(p.client_id); continue; }
        const arr = bySession.get(key) ?? [];
        arr.push(p);
        bySession.set(key, arr);
      }
      for (const [, arr] of bySession) {
        try {
          const rows = arr.map((p) => ({ ...p.payload, user_id: p.user_id, client_id: p.client_id }));
          const { error } = await supabase
            .from("detected_plates")
            .upsert(rows as unknown as never, { onConflict: "user_id,client_id" });
          if (error) throw error;
          for (const p of arr) await deletePlate(p.client_id);
          pushed += arr.length;
        } catch (err) {
          failed += arr.length;
          for (const p of arr) await bumpAttempt("pending_plates", p.client_id, err instanceof Error ? err.message : String(err));
        }
      }
    }

    state.lastSyncAt = Date.now();
    await setMeta("last_sync_at", state.lastSyncAt);
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : String(err);
  } finally {
    state.syncing = false;
    await refreshCounts();
    notify();
  }
  return { pushed, failed };
}

/** Snapshot the user's plate DB to IndexedDB for offline matching. */
export async function refreshPlatesCache(): Promise<{ count: number }> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { count: 0 };
  if (!(typeof navigator === "undefined" ? true : navigator.onLine)) return { count: 0 };
  const all: CachedPlate[] = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("plates")
      .select("id, plate_raw, plate_normalized, bank, car_type, chassis, plate_date")
      .eq("user_id", u.user.id)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) all.push(r as CachedPlate);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  await cachePlates(u.user.id, all);
  await setMeta("plates_cache_refreshed_at", Date.now());
  return { count: all.length };
}

/** Start listeners + periodic retry. Safe to call multiple times. */
export function startSyncEngine() {
  if (started || typeof window === "undefined") return;
  started = true;

  const online = () => {
    state.online = true;
    notify();
    void syncNow();
  };
  const offline = () => {
    state.online = false;
    notify();
  };
  window.addEventListener("online", online);
  window.addEventListener("offline", offline);

  intervalId = setInterval(() => {
    if (state.online && !state.syncing) void syncNow();
  }, 30_000);

  void refreshCounts().then(() => {
    if (state.online) void syncNow();
  });
}

export function stopSyncEngine() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
  started = false;
}
