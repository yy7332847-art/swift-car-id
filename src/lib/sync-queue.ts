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
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

const MIN_DELAY = 5_000;
const IDLE_DELAY = 60_000;
const MAX_DELAY = 15 * 60_000;

/** Reschedule the next drain based on the earliest queued next_retry_at. */
async function scheduleNextRun() {
  if (typeof window === "undefined") return;
  if (scheduledTimer) { clearTimeout(scheduledTimer); scheduledTimer = null; }
  if (!state.online) return;
  let delay = IDLE_DELAY;
  try {
    const earliest = await earliestNextRetryAt();
    if (earliest !== null) {
      const now = Date.now();
      delay = Math.max(MIN_DELAY, Math.min(MAX_DELAY, earliest - now));
      if (earliest <= now) delay = MIN_DELAY;
    }
  } catch { /* ignore */ }
  scheduledTimer = setTimeout(() => { if (state.online && !state.syncing) void syncNow(); }, delay);
}

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

export async function syncNow(): Promise<{ pushed: number; failed: number; deferred: number }> {
  if (state.syncing) return { pushed: 0, failed: 0, deferred: 0 };
  if (!(typeof navigator === "undefined" ? true : navigator.onLine)) {
    state.online = false;
    notify();
    return { pushed: 0, failed: 0, deferred: 0 };
  }
  state.syncing = true;
  state.lastError = null;
  notify();

  let pushed = 0;
  let failed = 0;
  let deferred = 0;
  const now = Date.now();

  try {
    const sessions = await listPendingSessions();
    const sessionServerIds = new Map<string, string>();

    for (const s of sessions) {
      if ((s.next_retry_at ?? 0) > now) { deferred += 1; continue; }
      try {
        const { data, error } = await supabase
          .from("recognition_sessions")
          .upsert({ ...s.payload, client_id: s.client_id, user_id: s.user_id } as unknown as never, { onConflict: "user_id,client_id" })
          .select("id")
          .single();
        if (error || !data) throw error ?? new Error("upsert failed");
        sessionServerIds.set(s.client_id, data.id as string);

        const plates = await listPendingPlatesFor(s.client_id);
        const ready = plates.filter((p) => (p.next_retry_at ?? 0) <= now);
        if (ready.length > 0) {
          const rows = ready.map((p) => ({
            ...p.payload,
            session_id: data.id,
            user_id: p.user_id,
            client_id: p.client_id,
          }));
          const { error: pErr } = await supabase
            .from("detected_plates")
            .upsert(rows as unknown as never, { onConflict: "user_id,client_id" });
          if (pErr) throw pErr;
          for (const p of ready) await deletePlate(p.client_id);
          pushed += ready.length;
        }
        // Only remove the session record when no plates remain linked to it.
        const remaining = await listPendingPlatesFor(s.client_id);
        if (remaining.length === 0) {
          await deleteSession(s.client_id);
        } else {
          deferred += remaining.length;
        }
        pushed += 1;
      } catch (err) {
        failed += 1;
        await bumpAttempt("pending_sessions", s.client_id, err instanceof Error ? err.message : String(err));
      }
    }

    // Orphan plates: session was already saved server-side previously.
    const allPlates = await listAllPendingPlates();
    const orphanPlates = allPlates.filter((p) => !sessions.find((s) => s.client_id === p.session_client_id));
    if (orphanPlates.length > 0) {
      const bySession = new Map<string, typeof orphanPlates>();
      for (const p of orphanPlates) {
        if ((p.next_retry_at ?? 0) > now) { deferred += 1; continue; }
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
    scheduleNextRun();
  }
  return { pushed, failed, deferred };
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
