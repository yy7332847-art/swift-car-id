import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, CheckCircle2, AlertTriangle, Loader2, Info, Car, Settings2, X, Radio, Sparkles, MapPin, MapPinOff, Activity, Copy, GitMerge, HelpCircle, FileDown } from "lucide-react";
import { startRecorder, type RecorderChunkMeta, type RecorderHandle } from "@/lib/audio-recorder";
import { extractPlates, plateAppearsInText, type DetectedPlate } from "@/lib/plate-utils";
import { TrackingMap } from "@/components/TrackingMap";
import { checkGeoPermission, requestGeoPermission, watchGeo, shouldAcceptPoint, smoothPath, runGeoPreflight, isAndroid, type GeoPoint, type WatchHandle, type PermissionState, type GeoPreflight } from "@/lib/geo";
import { loadSettings } from "@/lib/settings";
import { detectDuplicate, formatGap, formatDistance, type DuplicateMatch } from "@/lib/duplicate-detection";
import { enqueueSession, enqueuePlates } from "@/lib/offline-store";
import { syncNow } from "@/lib/sync-queue";

interface PerfSample { chunkGapMs: number; sttMs: number; parseMs: number; matchMs: number; totalMs: number; textLen: number; at: number }
interface PerfStats { count: number; avgChunkGapMs: number; avgSttMs: number; avgParseMs: number; avgMatchMs: number; avgTotalMs: number; lastLagMs: number; queue: number }
const PERF_BUFFER_SIZE = 20;
function computePerfStats(samples: PerfSample[], queue: number): PerfStats {
  if (samples.length === 0) return { count: 0, avgChunkGapMs: 0, avgSttMs: 0, avgParseMs: 0, avgMatchMs: 0, avgTotalMs: 0, lastLagMs: 0, queue };
  const s = samples.reduce((a, x) => ({ chunkGapMs: a.chunkGapMs + x.chunkGapMs, sttMs: a.sttMs + x.sttMs, parseMs: a.parseMs + x.parseMs, matchMs: a.matchMs + x.matchMs, totalMs: a.totalMs + x.totalMs }), { chunkGapMs: 0, sttMs: 0, parseMs: 0, matchMs: 0, totalMs: 0 });
  const n = samples.length;
  return { count: n, avgChunkGapMs: s.chunkGapMs / n, avgSttMs: s.sttMs / n, avgParseMs: s.parseMs / n, avgMatchMs: s.matchMs / n, avgTotalMs: s.totalMs / n, lastLagMs: samples[samples.length - 1]?.totalMs ?? 0, queue };
}

export const Route = createFileRoute("/_authenticated/record")({
  head: () => ({
    meta: [
      { title: "التسجيل الصوتي — مجدي للتشييك" },
      { name: "description", content: "جلسة تسجيل صوتي فورية لاكتشاف لوحات السيارات ومطابقتها بقاعدة Excel." },
      { property: "og:title", content: "التسجيل الصوتي — مجدي للتشييك" },
      { property: "og:description", content: "اكتشاف لوحات السيارات من الكلام المباشر وعرض المطابقة فورًا أثناء القيادة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RecordPage,
});

type PlateInfo = { id: string; plate_raw: string; plate_normalized: string; bank: string | null; car_type: string | null; chassis: string | null; plate_date: string | null };

interface PlateEntry extends DetectedPlate {
  id: string;
  spokenAt: number;
  spokenText: string;
  matchedPlateId?: string | null;
  closestPlate?: { raw: string; score: number } | null;
  latitude?: number | null;
  longitude?: number | null;
  matchedPlate?: Omit<PlateInfo, "id" | "plate_normalized">;
  duplicateOfId?: string | null;
  duplicateDecision?: "same" | "different" | "unresolved" | null;
  duplicateDistanceM?: number | null;
  duplicateGapSec?: number | null;
}

const DRAFT_KEY = "platecheck.active-recording-draft.v4";

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript: string } };
type SpeechRecognitionEventLike = { resultIndex: number; results: SpeechRecognitionResultLike[] };
type SpeechRecognitionErrorLike = { error?: string };
type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type TextSource = "instant" | "stt";
type IngestMetrics = { accepted: boolean; captured: boolean; parseMs: number; matchMs: number; textLen: number };
type PendingAudioChunk = { wav: Blob; meta?: RecorderChunkMeta; queuedAt: number };
type VoiceStatus = {
  mode: "idle" | "listening" | "low" | "queued" | "recovering" | "error";
  message: string;
  queue: number;
  restarts: number;
  errors: number;
  lastRms: number;
};

function createSpeechRecognition(): BrowserSpeechRecognition | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & { SpeechRecognition?: new () => BrowserSpeechRecognition; webkitSpeechRecognition?: new () => BrowserSpeechRecognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

function cleanRecognizedText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function isMobileSpeechDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function playCaptureTone(complete: boolean) {
  if (typeof window === "undefined") return;
  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  try {
    const ctx = new AudioCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = complete ? 880 : 520;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (complete ? 0.11 : 0.18));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (complete ? 0.12 : 0.2));
    window.setTimeout(() => { void ctx.close().catch(() => undefined); }, 260);
  } catch {
    // Audio feedback is best-effort only.
  }
}

function RecordPage() {
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: isAdmin });

  const { data: platesIndex, isLoading: platesLoading } = useQuery({
    queryKey: ["plates-index"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { map: new Map<string, PlateInfo>(), list: [] as PlateInfo[], count: 0, source: "empty" as const };
      const map = new Map<string, PlateInfo>();
      const list: PlateInfo[] = [];
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      if (online) {
        try {
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
            for (const p of data) { map.set(p.plate_normalized, p); list.push(p); }
            if (data.length < PAGE) break;
            from += PAGE;
          }
          // Refresh offline cache in the background so a later drop-out is covered.
          void import("@/lib/sync-queue").then((m) => m.refreshPlatesCache().catch(() => {}));
          return { map, list, count: map.size, source: "server" as const };
        } catch (e) {
          console.warn("[plates-index] server fetch failed, trying offline cache", e);
        }
      }
      // Offline (or server failed) → hydrate from IndexedDB snapshot.
      try {
        const { openDB } = await import("idb");
        const db = await openDB("plate-offline-v1", 1);
        const all = (await db.getAll("plates_cache")) as PlateInfo[];
        for (const p of all) { map.set(p.plate_normalized, p); list.push(p); }
        return { map, list, count: map.size, source: "cache" as const };
      } catch {
        return { map, list, count: 0, source: "empty" as const };
      }
    },
  });

  const { data: reliability } = useQuery({
    queryKey: ["record-reliability"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { avgDetectSec: 0, matchRate: 0, sessions: 0 };
      const { data } = await supabase
        .from("recognition_sessions")
        .select("started_at, ended_at, total_detected, total_matched")
        .eq("user_id", u.user.id)
        .not("ended_at", "is", null)
        .order("started_at", { ascending: false })
        .limit(10);
      const rows = data ?? [];
      let totalDetected = 0, totalMatched = 0, totalSeconds = 0;
      for (const s of rows) {
        totalDetected += s.total_detected ?? 0;
        totalMatched += s.total_matched ?? 0;
        totalSeconds += s.ended_at ? Math.max(0, (new Date(s.ended_at).getTime() - new Date(s.started_at).getTime()) / 1000) : 0;
      }
      return {
        avgDetectSec: totalDetected > 0 ? totalSeconds / totalDetected : 0,
        matchRate: totalDetected > 0 ? totalMatched / totalDetected : 0,
        sessions: rows.length,
      };
    },
  });

  const [calibrating, setCalibrating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [entries, setEntries] = useState<PlateEntry[]>([]);
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lastCapture, setLastCapture] = useState<{ raw: string; complete: boolean; matched: boolean; at: number } | null>(null);
  const [geoOn, setGeoOn] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoPerm, setGeoPerm] = useState<PermissionState>("prompt");
  const [path, setPath] = useState<GeoPoint[]>([]);
  const [preflight, setPreflight] = useState<GeoPreflight | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ entryId: string; original: PlateEntry; match: DuplicateMatch } | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({ mode: "idle", message: "جاهز", queue: 0, restarts: 0, errors: 0, lastRms: 0 });

  const currentPosRef = useRef<GeoPoint | null>(null);
  const geoWatchRef = useRef<WatchHandle | null>(null);
  const rawPathRef = useRef<GeoPoint[]>([]);
  // (path throttling now handled inside geo.ts via shouldAcceptPoint)
  const pathRef = useRef<GeoPoint[]>([]);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);
  const processChunkRef = useRef<(wav: Blob, meta?: RecorderChunkMeta) => void>(() => undefined);
  const chunkQueueRef = useRef<PendingAudioChunk[]>([]);
  const processingLoopActiveRef = useRef(false);
  const recorderRestartingRef = useRef(false);
  const speechRestartTimerRef = useRef<number | null>(null);
  const pendingRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const entriesRef = useRef<PlateEntry[]>([]);
  const growableRef = useRef<Map<string, { entryId: string; digits: string; at: number; normalized: string }>>(new Map());
  const finalizedRef = useRef<Map<string, number>>(new Map());
  const restoredRef = useRef(false);
  const perfBufferRef = useRef<PerfSample[]>([]);
  const lastChunkAtRef = useRef<number>(0);
  const [perfStats, setPerfStats] = useState<PerfStats>({ count: 0, avgChunkGapMs: 0, avgSttMs: 0, avgParseMs: 0, avgMatchMs: 0, avgTotalMs: 0, lastLagMs: 0, queue: 0 });
  const draftSaveTimerRef = useRef<number | null>(null);
  const recentTextRef = useRef<Map<string, number>>(new Map());
  const lastInstantTextRef = useRef("");
  const instantSpeechActiveRef = useRef(false);
  const lastInstantAtRef = useRef(0);
  const lastInstantPlateAtRef = useRef(0);
  const lastIncompleteToneAtRef = useRef(0);
  const lastAudioChunkAtRef = useRef(0);
  const lastSttOkAtRef = useRef(0);
  const sttBackoffUntilRef = useRef(0);
  const sttBackoffMsRef = useRef(0);
  const voiceRestartCountRef = useRef(0);
  const voiceErrorCountRef = useRef(0);
  const rollingSpeechBufferRef = useRef<{ text: string; at: number }[]>([]);
  const ingestTextRef = useRef<(rawText: string, opts?: { source?: TextSource; partial?: boolean }) => IngestMetrics>((rawText) => ({ accepted: false, captured: false, parseMs: 0, matchMs: 0, textLen: rawText.length }));

  type DiagEvent = { t: number; type: string; data?: Record<string, unknown> };
  const diagnosticsLogRef = useRef<DiagEvent[]>([]);
  const diagSessionStartRef = useRef<number>(Date.now());
  const logDiag = useCallback((type: string, data?: Record<string, unknown>) => {
    const buf = diagnosticsLogRef.current;
    buf.push({ t: Date.now(), type, data });
    if (buf.length > 500) buf.splice(0, buf.length - 500);
  }, []);

  const updateVoiceStatus = useCallback((patch: Partial<VoiceStatus>) => {
    setVoiceStatus((prev) => ({ ...prev, ...patch, restarts: voiceRestartCountRef.current, errors: voiceErrorCountRef.current }));
  }, []);


  const exportDiagnostics = useCallback(() => {
    const now = Date.now();
    const events = diagnosticsLogRef.current;
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
    const report = {
      generatedAt: new Date(now).toISOString(),
      appVersion: "plate-check",
      session: {
        id: sessionIdRef.current,
        startedAt: diagSessionStartRef.current ? new Date(diagSessionStartRef.current).toISOString() : null,
        durationSec: diagSessionStartRef.current ? Math.round((now - diagSessionStartRef.current) / 1000) : 0,
        recording,
      },
      device: {
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        mobile: isMobileSpeechDevice(),
        language: typeof navigator !== "undefined" ? navigator.language : "",
        online: typeof navigator !== "undefined" ? navigator.onLine : true,
      },
      voiceStatus,
      perfStats,
      totals: {
        entries: entriesRef.current.length,
        pending: chunkQueueRef.current.length,
        restarts: voiceRestartCountRef.current,
        errors: voiceErrorCountRef.current,
        sttBackoffMs: sttBackoffMsRef.current,
        sttBackoffUntil: sttBackoffUntilRef.current ? new Date(sttBackoffUntilRef.current).toISOString() : null,
        lastAudioChunkAt: lastAudioChunkAtRef.current ? new Date(lastAudioChunkAtRef.current).toISOString() : null,
        lastSttOkAt: lastSttOkAtRef.current ? new Date(lastSttOkAtRef.current).toISOString() : null,
      },
      eventCounts: counts,
      events: events.map((e) => ({ at: new Date(e.t).toISOString(), tOffsetMs: e.t - diagSessionStartRef.current, type: e.type, ...(e.data ? { data: e.data } : {}) })),
    };
    try {
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `plate-diagnostics-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`تم تصدير تقرير التشخيص (${events.length} حدث)`);
    } catch (err) {
      toast.error("تعذر تصدير التشخيص");
      console.error(err);
    }
  }, [recording, voiceStatus, perfStats]);

  const applyEntries = useCallback((next: PlateEntry[]) => {
    entriesRef.current = next;
    setEntries(next);
  }, []);

  useEffect(() => {
    if (!startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(iv);
  }, [startedAt]);

  useEffect(() => { pathRef.current = path; }, [path]);

  const startCapture = useCallback(async () => {
    if (recorderRef.current) return;
    setRecording(true);
    try {
      startGeoTracking();
      startInstantSpeech();
      recorderRef.current = await startRecorder({
        chunkSeconds: isMobileSpeechDevice() ? 1.15 : 0.95,
        overlapSeconds: isMobileSpeechDevice() ? 0.45 : 0.3,
        targetSampleRate: 16000,
        onLevel: setLevel,
        onChunk: (wav, meta) => processChunkRef.current(wav, meta),
        onChunkSkipped: (meta) => { logDiag("chunk_skipped_silent", { rms: meta.rms, durationMs: meta.durationMs }); updateVoiceStatus({ mode: "low", message: "الصوت منخفض — قرّب الميكروفون أو ارفع صوتك", lastRms: meta.rms }); },
      });
    } catch (err) {
      setRecording(false);
      stopInstantSpeech();
      stopGeoTracking();
      throw err;
    }
  }, [updateVoiceStatus, logDiag]);

  useEffect(() => {
    localStorage.removeItem(DRAFT_KEY);
    return () => { if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current); };
  }, []);

  useEffect(() => {
    if (restoredRef.current || platesLoading) return;
    restoredRef.current = true;
    localStorage.removeItem(DRAFT_KEY);
  }, [applyEntries, platesLoading, startCapture]);

  const ingestRecognizedText = useCallback((rawText: string, opts: { source?: TextSource; partial?: boolean } = {}) => {
    const source = opts.source ?? "instant";
    const text = cleanRecognizedText(rawText);
    const tParseStart = performance.now();
    if (!text || text.length < 2) return { accepted: false, captured: false, parseMs: 0, matchMs: 0, textLen: text.length };
    if (source === "instant" || isMobileSpeechDevice() || !instantSpeechActiveRef.current) setLiveText(text);
    const now = Date.now();
    const dedupeKey = text.replace(/[\s،.,؟?!:؛;\-_/\\|()[\]{}]/g, "");
    const lastAt = recentTextRef.current.get(dedupeKey);
    if (lastAt && now - lastAt < 650) return { accepted: false, captured: false, parseMs: 0, matchMs: 0, textLen: text.length };
    recentTextRef.current.set(dedupeKey, now);
    for (const [key, at] of recentTextRef.current) if (now - at > 12000) recentTextRef.current.delete(key);
    setTranscript((prev) => (prev + " " + text).trim().slice(-3000));
    const rolling = rollingSpeechBufferRef.current;
    if (rolling[rolling.length - 1]?.text !== text) rolling.push({ text, at: now });
    while (rolling.length > 0 && (now - rolling[0].at > 4500 || rolling.length > 8)) rolling.shift();
    const parseText = cleanRecognizedText(rolling.map((part) => part.text).join(" ")) || text;
    const plates = extractPlates(parseText);
    const parseMs = performance.now() - tParseStart;
    if (plates.length === 0) return { accepted: true, captured: false, parseMs, matchMs: 0, textLen: text.length };
    const tMatchStart = performance.now();
    let captured = false;

    for (const p of plates) {
      if (!plateAppearsInText(p.letters, p.digits, parseText)) continue;
      const match = platesIndex?.map.get(p.normalized);
      const isMatched = !!match && p.complete && p.confidence >= 0.85;
      const closest = !isMatched ? findClosestPlate(p.normalized, platesIndex?.list ?? []) : null;
      const enriched: DetectedPlate = {
        ...p,
        suspectPart: p.suspectPart ?? missingPartsLabel(p),
        correctionNote: p.correctionNote ?? (closest ? `أقرب بديل في Excel: ${closest.raw} بنسبة ${Math.round(closest.score * 100)}%` : undefined),
      };
      const key = enriched.letters;
      const existing = growableRef.current.get(key);
      if (existing && enriched.digits.startsWith(existing.digits) && enriched.digits.length > existing.digits.length && now - existing.at < 6000) {
        applyEntries(entriesRef.current.map((e) => e.id === existing.entryId ? {
          ...e,
          ...enriched,
          spokenText: `${e.spokenText} ${parseText}`.trim().slice(-700),
          matchedPlateId: isMatched && match ? match.id : null,
          closestPlate: closest,
          matchedPlate: isMatched && match ? toMatched(match) : undefined,
        } : e));
        captured = true;
        setLastCapture({ raw: enriched.raw, complete: enriched.complete, matched: isMatched, at: now });
        if (enriched.complete) {
          growableRef.current.delete(key);
          finalizedRef.current.set(enriched.normalized, now);
          playCaptureTone(true);
          if (isMatched) {
            if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
            toast.success(`تطابق: ${enriched.raw}`, { description: match?.car_type || undefined });
          }
        } else {
          growableRef.current.set(key, { ...existing, digits: enriched.digits, at: now, normalized: enriched.normalized });
          if (now - lastIncompleteToneAtRef.current > 1800) {
            lastIncompleteToneAtRef.current = now;
            playCaptureTone(false);
            if (navigator.vibrate) navigator.vibrate(25);
          }
        }
        continue;
      }

      const lastSame = finalizedRef.current.get(enriched.normalized);
      // Short 4s STT-jitter cooldown — still treat as noise, no user prompt.
      if (lastSame && now - lastSame < 4000) continue;
      const pos = currentPosRef.current;

      // Smart duplicate detection (only after the short cooldown, only for complete plates).
      let dupInfo: { originalId: string; decision: "same" | "different" | "unresolved"; distanceM: number | null; gapSec: number; needsPrompt: boolean; original: PlateEntry; match: DuplicateMatch } | null = null;
      if (enriched.complete) {
        const dupCfg = loadSettings().duplicateDetection;
        const candidates = entriesRef.current.map((e) => ({ id: e.id, normalized: e.normalized, spokenAt: e.spokenAt, latitude: e.latitude, longitude: e.longitude, duplicateDecision: e.duplicateDecision ?? null, duplicateOfId: e.duplicateOfId ?? null }));
        const match = detectDuplicate(
          { normalized: enriched.normalized, latitude: pos?.lat ?? null, longitude: pos?.lng ?? null, spokenAt: now },
          candidates,
          dupCfg,
        );
        if (match) {
          const original = entriesRef.current.find((e) => e.id === match.original.id);
          if (original) {
            dupInfo = {
              originalId: original.id,
              decision: match.kind === "auto" ? "same" : "unresolved",
              distanceM: match.distanceMeters,
              gapSec: match.gapSeconds,
              needsPrompt: match.kind === "prompt",
              original,
              match,
            };
          }
        }
      }

      const entry: PlateEntry = {
        ...enriched,
        id: crypto.randomUUID(),
        spokenAt: now,
        spokenText: parseText,
        matchedPlateId: isMatched && match ? match.id : null,
        closestPlate: closest,
        latitude: pos?.lat ?? null,
        longitude: pos?.lng ?? null,
        matchedPlate: isMatched && match ? toMatched(match) : undefined,
        duplicateOfId: dupInfo?.originalId ?? null,
        duplicateDecision: dupInfo?.decision ?? null,
        duplicateDistanceM: dupInfo?.distanceM ?? null,
        duplicateGapSec: dupInfo?.gapSec ?? null,
      };
      applyEntries([entry, ...entriesRef.current].slice(0, 500));
      captured = true;
      setLastCapture({ raw: enriched.raw, complete: enriched.complete, matched: isMatched, at: now });
      if (enriched.complete) {
        finalizedRef.current.set(enriched.normalized, now);
        playCaptureTone(true);
        if (dupInfo?.needsPrompt) {
          setDuplicatePrompt({ entryId: entry.id, original: dupInfo.original, match: dupInfo.match });
          if (navigator.vibrate) navigator.vibrate([30, 20, 30]);
        } else if (dupInfo?.decision === "same") {
          toast(`مكرّرة تلقائياً: ${enriched.raw}`, { description: `${formatGap(dupInfo.gapSec)} • ${formatDistance(dupInfo.distanceM)}` });
        } else if (isMatched) {
          if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
          toast.success(`تطابق: ${enriched.raw}`, { description: match?.car_type || undefined });
        }
      } else {
        growableRef.current.set(key, { entryId: entry.id, digits: enriched.digits, at: now, normalized: enriched.normalized });
        if (now - lastIncompleteToneAtRef.current > 1800) {
          lastIncompleteToneAtRef.current = now;
          playCaptureTone(false);
          if (navigator.vibrate) navigator.vibrate(25);
        }
      }
    }
    if (source === "instant" && captured) lastInstantPlateAtRef.current = now;
    return { accepted: true, captured, parseMs, matchMs: performance.now() - tMatchStart, textLen: text.length };
  }, [applyEntries, platesIndex]);

  useEffect(() => {
    ingestTextRef.current = ingestRecognizedText;
  }, [ingestRecognizedText]);

  function startInstantSpeech() {
    if (speechRef.current) return;
    const rec = createSpeechRecognition();
    if (!rec) return;
    rec.lang = "ar-SA";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      let interim = "";
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const phrase = cleanRecognizedText(event.results[i]?.[0]?.transcript ?? "");
        if (!phrase) continue;
        if (event.results[i].isFinal) finalText += ` ${phrase}`;
        else interim += ` ${phrase}`;
      }
      const visible = cleanRecognizedText(`${finalText} ${interim}`);
      if (visible) {
        lastInstantAtRef.current = Date.now();
        setLiveText(visible);
        const key = visible.replace(/\s+/g, " ");
        if (key !== lastInstantTextRef.current) {
          lastInstantTextRef.current = key;
          ingestTextRef.current(visible, { source: "instant", partial: !finalText });
        }
      }
      if (finalText) ingestTextRef.current(finalText, { source: "instant" });
    };
    rec.onerror = (event: SpeechRecognitionErrorLike) => {
      instantSpeechActiveRef.current = false;
      voiceErrorCountRef.current++;
      logDiag("speech_error", { error: event?.error ?? "unknown" });
      updateVoiceStatus({ mode: "recovering", message: event?.error === "no-speech" ? "لم يصل كلام واضح — أعيد فتح السماع" : "أعيد تشغيل السماع المباشر" });
      try { rec.abort(); } catch { /* noop */ }
      if (sessionIdRef.current) scheduleInstantSpeechRestart(450);
    };
    rec.onend = () => {
      instantSpeechActiveRef.current = false;
      if (sessionIdRef.current) {
        speechRef.current = null;
        scheduleInstantSpeechRestart(350);
      }
    };
    speechRef.current = rec;
    try { rec.start(); instantSpeechActiveRef.current = true; } catch { speechRef.current = null; instantSpeechActiveRef.current = false; }
  }

  function stopInstantSpeech() {
    if (speechRestartTimerRef.current) {
      window.clearTimeout(speechRestartTimerRef.current);
      speechRestartTimerRef.current = null;
    }
    const rec = speechRef.current;
    speechRef.current = null;
    instantSpeechActiveRef.current = false;
    if (!rec) return;
    rec.onend = null;
    try { rec.stop(); } catch { try { rec.abort(); } catch { /* noop */ } }
  }

  function scheduleInstantSpeechRestart(delayMs: number) {
    if (speechRestartTimerRef.current) window.clearTimeout(speechRestartTimerRef.current);
    speechRestartTimerRef.current = window.setTimeout(() => {
      speechRestartTimerRef.current = null;
      if (!sessionIdRef.current || speechRef.current) return;
      voiceRestartCountRef.current++;
      logDiag("speech_restart", { restarts: voiceRestartCountRef.current });
      startInstantSpeech();
    }, delayMs);
  }

  const processChunk = useCallback(async (wav: Blob, meta?: RecorderChunkMeta) => {
    setProcessing(true);
    if (meta) updateVoiceStatus({ mode: "queued", message: "أحلّل الصوت الآن", lastRms: meta.rms, queue: chunkQueueRef.current.length });
    const t0 = performance.now();
    const chunkGap = lastChunkAtRef.current ? t0 - lastChunkAtRef.current : 0;
    lastChunkAtRef.current = t0;
    let sttMs = 0, parseMs = 0, matchMs = 0, textLen = 0;
    try {
      const backoffWait = Math.max(0, sttBackoffUntilRef.current - Date.now());
      if (backoffWait > 0) {
        logDiag("stt_backoff_wait", { waitMs: Math.min(backoffWait, 8000), backoffMs: sttBackoffMsRef.current });
        updateVoiceStatus({ mode: "queued", message: "أخفف ضغط التعرف الصوتي ثم أكمل تلقائياً", queue: chunkQueueRef.current.length });
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(backoffWait, 8000)));
      }
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token || !sessionIdRef.current) return;
      const form = new FormData();
      form.append("audio", wav, "chunk.wav");
      form.append("stream", "true");
      if (meta) form.append("rms", String(meta.rms));
      const tStt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 12000);
      const res = await fetch("/api/transcribe", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form, signal: controller.signal });
      window.clearTimeout(timeout);
      if (!res.ok) {
        voiceErrorCountRef.current++;
        const bodyText = await res.text().catch(() => "");
        if (res.status === 429) {
          sttBackoffMsRef.current = sttBackoffMsRef.current ? Math.min(sttBackoffMsRef.current * 2, 30000) : 6000;
          sttBackoffUntilRef.current = Date.now() + sttBackoffMsRef.current;
        }
        logDiag("stt_error", { status: res.status, statusText: res.statusText, backoffMs: sttBackoffMsRef.current, chunkMs: meta?.durationMs, rms: meta?.rms, body: bodyText.slice(0, 400) });
        updateVoiceStatus({ mode: "error", message: res.status === 429 ? "ضغط عالي على التعرف — أبطّئ الطلبات تلقائياً بدون إيقاف الجلسة" : "تعذر تحليل مقطع صوتي — التسجيل مستمر" });
        console.error("STT", res.status, bodyText);
        return;
      }
      sttBackoffMsRef.current = 0;
      sttBackoffUntilRef.current = 0;
      sttMs = performance.now() - tStt;
      // Browser speech recognition is the instant, user-visible source of truth.
      // On mobile, Web Speech is often unavailable or unreliable; server STT is the reliable path.
      // On desktop, suppress delayed STT only when native speech has already captured a plate.
      if (!isMobileSpeechDevice() && instantSpeechActiveRef.current && Date.now() - lastInstantPlateAtRef.current < 2500) return;
      const contentType = res.headers.get("content-type") ?? "";
      let finalText = "";
      let metrics: IngestMetrics = { accepted: false, captured: false, parseMs: 0, matchMs: 0, textLen: 0 };
      if (contentType.includes("text/event-stream") && res.body) {
        finalText = await readTranscriptionStream(res.body, (partial) => {
          metrics = ingestTextRef.current(partial, { source: "stt", partial: true });
        });
        if (finalText) metrics = ingestTextRef.current(finalText, { source: "stt" });
      } else {
        const json = await res.json();
        finalText = json.text || "";
        metrics = ingestRecognizedText(finalText, { source: "stt" });
      }
      parseMs = metrics.parseMs;
      matchMs = metrics.matchMs;
      textLen = metrics.textLen;
      lastSttOkAtRef.current = Date.now();
      logDiag("stt_ok", { sttMs: Math.round(sttMs), chunkMs: meta?.durationMs, rms: meta?.rms, textLen, captured: metrics.captured, streamed: contentType.includes("text/event-stream") });
      updateVoiceStatus({ mode: metrics.captured ? "listening" : "queued", message: metrics.captured ? "تم التقاط لوحة — السماع مستمر" : "أسمع الصوت ولم أجد لوحة مكتملة بعد", queue: chunkQueueRef.current.length });
    } catch (err) {
      voiceErrorCountRef.current++;
      const aborted = err instanceof DOMException && err.name === "AbortError";
      logDiag(aborted ? "stt_timeout" : "stt_exception", { message: err instanceof Error ? err.message : String(err), chunkMs: meta?.durationMs, rms: meta?.rms });
      updateVoiceStatus({ mode: "recovering", message: aborted ? "تحليل الصوت تأخر — تجاوزت المقطع وأكملت" : "حدث انقطاع مؤقت — التسجيل مستمر" });
      console.error(err);
    } finally {
      const totalMs = performance.now() - t0;
      const sample: PerfSample = { chunkGapMs: chunkGap, sttMs, parseMs, matchMs, totalMs, textLen, at: Date.now() };
      const buf = perfBufferRef.current;
      buf.push(sample);
      if (buf.length > PERF_BUFFER_SIZE) buf.shift();
      setPerfStats(computePerfStats(buf, chunkQueueRef.current.length));
      if (import.meta.env.DEV) console.debug("[perf]", { gap: `${sample.chunkGapMs.toFixed(0)}ms`, stt: `${sttMs.toFixed(0)}ms`, parse: `${parseMs.toFixed(0)}ms`, total: `${totalMs.toFixed(0)}ms`, textLen, queue: chunkQueueRef.current.length });
    }
  }, [ingestRecognizedText, updateVoiceStatus, logDiag]);

  const drainAudioQueue = useCallback(async () => {
    if (processingLoopActiveRef.current) return;
    processingLoopActiveRef.current = true;
    try {
      while (sessionIdRef.current && chunkQueueRef.current.length > 0) {
        const next = chunkQueueRef.current.shift();
        pendingRef.current = chunkQueueRef.current.length + 1;
        updateVoiceStatus({ queue: chunkQueueRef.current.length, mode: "queued", message: "أحلّل الصوت الآن" });
        if (next) await processChunk(next.wav, next.meta);
      }
    } finally {
      processingLoopActiveRef.current = false;
      pendingRef.current = chunkQueueRef.current.length;
      if (pendingRef.current === 0) setProcessing(false);
      updateVoiceStatus({ queue: chunkQueueRef.current.length, mode: sessionIdRef.current ? "listening" : "idle", message: sessionIdRef.current ? "السماع مستمر" : "جاهز" });
      if (sessionIdRef.current && chunkQueueRef.current.length > 0) void drainAudioQueue();
    }
  }, [processChunk, updateVoiceStatus]);

  const enqueueAudioChunk = useCallback((wav: Blob, meta?: RecorderChunkMeta) => {
    lastAudioChunkAtRef.current = Date.now();
    const maxQueue = isMobileSpeechDevice() ? 4 : 5;
    while (chunkQueueRef.current.length >= maxQueue) chunkQueueRef.current.shift();
    chunkQueueRef.current.push({ wav, meta, queuedAt: Date.now() });
    pendingRef.current = chunkQueueRef.current.length + (processingLoopActiveRef.current ? 1 : 0);
    updateVoiceStatus({ mode: chunkQueueRef.current.length > 2 ? "queued" : "listening", message: chunkQueueRef.current.length > 2 ? "يوجد صوت كثير — أعالج الأحدث أولاً" : "وصل صوت واضح", queue: chunkQueueRef.current.length, lastRms: meta?.rms ?? 0 });
    void drainAudioQueue();
  }, [drainAudioQueue, updateVoiceStatus]);

  useEffect(() => {
    processChunkRef.current = enqueueAudioChunk;
  }, [enqueueAudioChunk]);

  useEffect(() => {
    if (!recording) return;
    const iv = window.setInterval(() => {
      const now = Date.now();
      if (recorderRef.current && lastAudioChunkAtRef.current && now - lastAudioChunkAtRef.current > 6500 && !recorderRestartingRef.current) {
        recorderRestartingRef.current = true;
        voiceRestartCountRef.current++;
        logDiag("recorder_restart", { silenceMs: now - lastAudioChunkAtRef.current, restarts: voiceRestartCountRef.current });
        updateVoiceStatus({ mode: "recovering", message: "لم يصل صوت جديد — أعيد فتح الميكروفون تلقائياً" });
        void (async () => {
          try {
            await recorderRef.current?.stop();
            recorderRef.current = null;
            await startCapture();
          } catch (e) {
            voiceErrorCountRef.current++;
            logDiag("recorder_restart_failed", { message: e instanceof Error ? e.message : String(e) });
            updateVoiceStatus({ mode: "error", message: "تعذر إعادة فتح الميكروفون — اضغط إيقاف ثم ابدأ" });
          } finally {
            recorderRestartingRef.current = false;
          }
        })();
      } else if (sessionIdRef.current && lastSttOkAtRef.current && now - lastSttOkAtRef.current > 15000 && chunkQueueRef.current.length === 0) {
        updateVoiceStatus({ mode: "low", message: "لا توجد لوحات جديدة — تأكد من وضوح النطق وقرب الميكروفون" });
      }
    }, 2500);
    return () => window.clearInterval(iv);
  }, [recording, startCapture, updateVoiceStatus, logDiag]);

  async function ensureGeoPermission(): Promise<PermissionState> {
    try {
      const cur = await checkGeoPermission();
      setGeoPerm(cur);
      if (cur === "granted") return cur;
      if (cur === "unsupported") {
        setGeoError("الموقع الجغرافي غير مدعوم على هذا الجهاز");
        return cur;
      }
      const asked = await requestGeoPermission();
      setGeoPerm(asked);
      if (asked === "denied") setGeoError("تم رفض إذن الموقع — فعّله من إعدادات التطبيق ثم أعد المحاولة");
      return asked;
    } catch (e) {
      setGeoError(e instanceof Error ? e.message : "تعذر فحص إذن الموقع");
      return "unsupported";
    }
  }

  async function startGeoTracking() {
    if (geoWatchRef.current) return;
    try {
      const perm = await ensureGeoPermission();
      if (perm !== "granted") return;
      setGeoError(null);
      geoWatchRef.current = await watchGeo(
        (raw) => {
          const pt: GeoPoint = { lat: raw.lat, lng: raw.lng, t: Date.now(), acc: raw.acc, spd: raw.spd ?? undefined, hdg: raw.hdg ?? undefined };
          currentPosRef.current = pt;
          setGeoOn(true);
          const prev = rawPathRef.current[rawPathRef.current.length - 1] ?? null;
          const speed = pt.spd ?? (prev && pt.t && prev.t ? (Math.hypot(pt.lat - prev.lat, pt.lng - prev.lng) * 111000) / Math.max(0.1, (pt.t - prev.t) / 1000) : 0);
          if (!prev) {
            rawPathRef.current = [pt];
            pathRef.current = [pt];
            setPath([pt]);
            return;
          }
          if (!shouldAcceptPoint(prev, pt, { speed, bufferSize: rawPathRef.current.length, config: loadSettings().batterySaver })) return;
          rawPathRef.current = [...rawPathRef.current, pt];
          const smoothed = smoothPath(rawPathRef.current);
          pathRef.current = smoothed;
          setPath(smoothed);
        },
        (msg, code) => {
          setGeoError(msg);
          setGeoOn(false);
          if (code === "denied") setGeoPerm("denied");
        },
        { background: true, backgroundTitle: "PlateCheck — تسجيل جلسة", backgroundMessage: "يتم تتبع مسار العربية أثناء التسجيل" },
      );
    } catch (e) {
      setGeoOn(false);
      setGeoError(e instanceof Error ? e.message : "تعذر تشغيل تتبع الموقع — التسجيل مستمر بدون خريطة");
      toast.warning("تعذر تشغيل GPS — التسجيل مستمر بدون خريطة");
    }
  }

  function stopGeoTracking() {
    if (geoWatchRef.current) {
      void Promise.resolve(geoWatchRef.current.stop()).catch(() => undefined);
      geoWatchRef.current = null;
    }
    setGeoOn(false);
  }

  async function beginSession() {
    if (!platesIndex || platesIndex.count === 0) {
      toast.warning("قم برفع ملف Excel أولاً");
      return;
    }
    // Run GPS pre-flight silently in the background — never block the user.
    // If accuracy is low we just show a soft toast, but recording starts now.
    runGeoPreflight()
      .then((pf) => {
        setPreflight(pf);
        if (pf.permission === "denied") toast.warning("إذن الموقع مرفوض — سيعمل التسجيل بدون خريطة");
        else if (pf.probe && pf.probe.acc > 100) toast("دقة GPS منخفضة — سيتم التحسين تلقائياً", { duration: 2500 });
      })
      .catch(() => {/* silent */});
    await confirmAndStart();
  }

  async function confirmAndStart() {
    setPreflightOpen(false);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const draftId = crypto.randomUUID();
      sessionIdRef.current = draftId;
      growableRef.current = new Map();
      finalizedRef.current = new Map();
      chunkQueueRef.current = [];
      pendingRef.current = 0;
      lastAudioChunkAtRef.current = 0;
      lastSttOkAtRef.current = 0;
      voiceErrorCountRef.current = 0;
      voiceRestartCountRef.current = 0;
      diagnosticsLogRef.current = [];
      diagSessionStartRef.current = Date.now();
      logDiag("session_started", { draftId: draftId.slice(0, 8), mobile: isMobileSpeechDevice(), userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "" });
      setVoiceStatus({ mode: "listening", message: "جاري فتح الميكروفون", queue: 0, restarts: 0, errors: 0, lastRms: 0 });
      setSessionId(draftId);
      setSavedSessionId(null);
      applyEntries([]);
      setTranscript("");
      setLiveText("");
      lastInstantTextRef.current = "";
      setPath([]);
      pathRef.current = [];
      currentPosRef.current = null;
      rawPathRef.current = [];
      setStartedAt(Date.now());
      setElapsed(0);
      await startCapture();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "تعذر بدء التسجيل");
    }
  }

  async function stopRecording() {
    setRecording(false);
    stopInstantSpeech();
    chunkQueueRef.current = chunkQueueRef.current.slice(-2);
    await recorderRef.current?.stop();
    recorderRef.current = null;
    stopGeoTracking();
    const waitStart = Date.now();
    while (pendingRef.current > 0 && Date.now() - waitStart < 8000) await new Promise((r) => setTimeout(r, 200));
    if (sessionIdRef.current) {
      await saveReviewedSession();
    }
    setLevel(0);
  }

  async function saveReviewedSession() {
    const current = entriesRef.current;
    if (!startedAt || !sessionIdRef.current) return;
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("غير مسجّل");
      const matched = current.filter((e) => e.matchedPlate).length;
      const incomplete = current.filter((e) => !e.complete).length;
      const duplicates = current.filter((e) => e.duplicateOfId && e.duplicateDecision === "same").length;
      const unique = current.length - duplicates;
      const platePath = [...current]
        .reverse()
        .filter((e) => e.latitude != null && e.longitude != null)
        .map((e) => ({ lat: e.latitude!, lng: e.longitude!, t: e.spokenAt }));
      const finalPath = pathRef.current.length >= 2 ? pathRef.current : platePath.length > 0 ? platePath : currentPosRef.current ? [currentPosRef.current] : [];
      const first = finalPath[0];

      const sessionClientId = sessionIdRef.current ?? crypto.randomUUID();
      const sessionPayload = {
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date().toISOString(),
        total_detected: current.length,
        total_matched: matched,
        total_incomplete: incomplete,
        total_unique: unique,
        total_duplicates: duplicates,
        path: finalPath,
        start_latitude: first?.lat ?? null,
        start_longitude: first?.lng ?? null,
        notes: transcript.slice(0, 1800),
      };
      const platesPayload = [...current].reverse().map((e) => ({
        id: e.id,
        spoken_text: e.spokenText,
        plate_raw: e.raw,
        plate_normalized: e.normalized,
        is_matched: !!e.matchedPlate,
        is_incomplete: !e.complete,
        matched_plate_id: e.matchedPlateId ?? null,
        confidence: e.confidence,
        suspect_part: e.suspectPart ?? null,
        correction_note: e.correctionNote ?? null,
        latitude: e.latitude ?? null,
        longitude: e.longitude ?? null,
        duplicate_of_id: e.duplicateOfId ?? null,
        duplicate_decision: e.duplicateDecision ?? null,
        duplicate_distance_m: e.duplicateDistanceM ?? null,
        duplicate_gap_seconds: e.duplicateGapSec ?? null,
      }));

      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      let serverSessionId: string | null = null;
      let savedOffline = false;

      if (online) {
        try {
          const { data: saved, error } = await supabase
            .from("recognition_sessions")
            .upsert(
              { ...sessionPayload, user_id: u.user.id, client_id: sessionClientId } as unknown as never,
              { onConflict: "user_id,client_id" },
            )
            .select("id")
            .single();
          if (error || !saved) throw error ?? new Error("تعذر حفظ الجلسة");
          serverSessionId = saved.id as string;
          if (platesPayload.length > 0) {
            const rows = platesPayload.map((p) => ({
              ...p,
              session_id: serverSessionId,
              user_id: u.user!.id,
              client_id: p.id,
            }));
            const { error: rowsErr } = await supabase
              .from("detected_plates")
              .upsert(rows as unknown as never, { onConflict: "user_id,client_id" });
            if (rowsErr) throw rowsErr;
          }
        } catch (netErr) {
          // Network/RLS/temporary failure → fall back to offline queue.
          console.warn("[save] server failed, queueing offline:", netErr);
          savedOffline = true;
        }
      } else {
        savedOffline = true;
      }

      if (savedOffline) {
        await enqueueSession({
          client_id: sessionClientId,
          user_id: u.user.id,
          payload: sessionPayload,
          created_at: Date.now(),
          attempts: 0,
        });
        if (platesPayload.length > 0) {
          await enqueuePlates(
            platesPayload.map((p) => ({
              client_id: p.id,
              session_client_id: sessionClientId,
              user_id: u.user!.id,
              payload: p,
              created_at: Date.now(),
              attempts: 0,
            })),
          );
        }
        // Fire-and-forget retry in case connectivity just came back.
        void syncNow();
      }

      localStorage.removeItem(DRAFT_KEY);
      setSavedSessionId(serverSessionId ?? sessionClientId);
      setSessionId(null);
      sessionIdRef.current = null;
      stopInstantSpeech();
      setStartedAt(null);
      if (savedOffline) {
        toast.success(`تم الحفظ محلياً — ${current.length} لوحة (سترفع تلقائياً عند رجوع الاتصال)`);
      } else {
        toast.success(`تم حفظ الجلسة — ${current.length} لوحة، ${matched} مطابقة`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "فشل حفظ الجلسة");
    } finally {
      setSaving(false);
    }
  }

  function discardDraft() {
    if (!confirm("حذف معاينة الجلسة بدون حفظ؟")) return;
    localStorage.removeItem(DRAFT_KEY);
    sessionIdRef.current = null;
    setSessionId(null);
    stopInstantSpeech();
    setStartedAt(null);
    setTranscript("");
    setLiveText("");
    applyEntries([]);
    setPath([]);
    pathRef.current = [];
    toast.success("تم حذف المسودة");
  }

  useEffect(() => () => { stopInstantSpeech(); void recorderRef.current?.stop(); stopGeoTracking(); }, []);

  const notActive = sub && !sub.active && !admin;

  return (
    <div className="flex min-h-full flex-col px-5 pt-8">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">التسجيل الصوتي</h1>
          <p className="text-xs text-muted-foreground">
            {platesLoading ? "جاري تحميل قاعدة اللوحات..." : `قاعدة: ${(platesIndex?.count ?? 0).toLocaleString("ar-EG")} لوحة`}
          </p>
        </div>
        {recording && <div className="rounded-full bg-destructive/20 px-3 py-1 text-xs font-bold text-destructive">● مباشر</div>}
      </div>

      {notActive && <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">الحساب غير مفعّل. لا يمكن استخدام التسجيل.</div>}

      <div className="my-4 flex flex-col items-center">
        <button onClick={recording ? stopRecording : beginSession} disabled={!!notActive || platesLoading || saving} className={`relative grid h-40 w-40 place-items-center rounded-full transition-all disabled:opacity-40 ${recording ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground glow-primary"}`}>
          {recording && <><motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.4 + level * 4], opacity: [0.6, 0] }} transition={{ duration: 1.5, repeat: Infinity }} /><motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.8 + level * 4], opacity: [0.4, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }} /></>}
          {recording ? <Square className="h-16 w-16" strokeWidth={2.5} fill="currentColor" /> : <Mic className="h-16 w-16" strokeWidth={2.5} />}
        </button>
        <p className="mt-4 text-lg font-black">{recording ? formatTime(elapsed) : saving ? "جاري الحفظ..." : "ابدأ جلسة جديدة"}</p>
        {processing && <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> جاري التعرّف...</p>}
        {!recording && <button onClick={() => setCalibrating(true)} disabled={!!notActive || saving} className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"><Settings2 className="h-3 w-3" /> معايرة الميكروفون</button>}
      </div>

      {recording && <LiveStatusBar processing={processing} transcript={liveText || transcript} lastCapture={lastCapture} level={level} />}
      {recording && <VoiceDiagnostics status={voiceStatus} level={level} onExport={exportDiagnostics} />}
      {recording && (
        <div className="mb-3 rounded-2xl border border-primary/25 bg-primary/5 p-3 text-right" dir="rtl">
          <div className="mb-1 text-[11px] font-bold text-primary">النص الخام المباشر</div>
          <div className="min-h-14 text-lg font-black leading-8 text-foreground">
            {(liveText || transcript.slice(-220)).trim() || "..."}
          </div>
          {transcript && <div className="mt-2 max-h-24 overflow-auto rounded-xl bg-background/60 p-2 text-sm font-bold leading-7 text-muted-foreground">{transcript}</div>}
        </div>
      )}

      {recording && (
        <div className="mb-3 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 font-bold">
              {geoOn ? <MapPin className="h-3.5 w-3.5 text-success" /> : <MapPinOff className="h-3.5 w-3.5 text-muted-foreground" />}
              {geoOn ? "تتبع الموقع مفعّل" : geoPerm === "denied" ? "الموقع مرفوض" : geoError ? "الموقع معطّل" : "بانتظار إشارة GPS..."}
            </span>
            {path.length > 0 && <span className="text-muted-foreground tabular-nums">{path.length} نقطة</span>}
          </div>
          {geoPerm === "denied" ? (
            <GeoDeniedBanner onRetry={() => void startGeoTracking()} />
          ) : (
            <TrackingMap path={path} markers={entries.filter((e) => e.latitude != null && e.longitude != null).map((e) => ({ id: e.id, lat: e.latitude!, lng: e.longitude!, label: e.raw, status: e.matchedPlate ? "matched" : e.complete ? "detected" : "incomplete" }))} follow showCar height={200} />
          )}
          {geoError && geoPerm !== "denied" && <p className="text-[10.5px] text-warning">{geoError}</p>}
        </div>
      )}

      <div className="mb-3 grid grid-cols-4 gap-2 text-center">
        <div className="glass rounded-xl p-2"><p className="text-lg font-black">{entries.length}</p><p className="text-[10px] text-muted-foreground">مكتشفة</p></div>
        <div className="glass rounded-xl p-2 border border-success/40"><p className="text-lg font-black text-success">{entries.filter((e) => e.matchedPlate).length}</p><p className="text-[10px] text-muted-foreground">مطابقة</p></div>
        <div className="glass rounded-xl p-2 border border-warning/40"><p className="text-lg font-black text-warning">{entries.filter((e) => !e.complete).length}</p><p className="text-[10px] text-muted-foreground">غير مكتملة</p></div>
        <div className="glass rounded-xl p-2 border border-primary/40"><p className="text-lg font-black text-primary tabular-nums">{entries.filter((e) => e.duplicateOfId && e.duplicateDecision === "same").length}</p><p className="text-[10px] text-muted-foreground">مكرّرة</p></div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-border bg-card/70 p-2"><p className="text-sm font-black tabular-nums">{reliability?.sessions ?? 0}</p><p className="text-[9.5px] text-muted-foreground">آخر جلسات</p></div>
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-2"><p className="text-sm font-black tabular-nums text-primary">{reliability?.avgDetectSec ? `${reliability.avgDetectSec.toFixed(1)}ث` : "—"}</p><p className="text-[9.5px] text-muted-foreground">متوسط الكشف</p></div>
        <div className="rounded-xl border border-success/25 bg-success/5 p-2"><p className="text-sm font-black tabular-nums text-success">{reliability?.matchRate ? `${Math.round(reliability.matchRate * 100)}%` : "—"}</p><p className="text-[9.5px] text-muted-foreground">معدل التطابق</p></div>
      </div>

      {recording && perfStats.count > 0 && <PerfPanel stats={perfStats} />}

      {!recording && savedSessionId && entries.length > 0 && <Link to="/sessions/$id" params={{ id: savedSessionId }} className="mb-3 block rounded-2xl bg-primary p-3 text-center text-sm font-bold text-primary-foreground">عرض تقرير الجلسة</Link>}

      <div className="flex-1 space-y-2 pb-4">
        <AnimatePresence initial={false}>{entries.slice(0, 80).map((e) => <PlateCard key={e.id} entry={e} allEntries={entries} onReopenDuplicate={(entry) => {
          if (!entry.duplicateOfId) return;
          const original = entries.find((x) => x.id === entry.duplicateOfId);
          if (!original) return;
          setDuplicatePrompt({ entryId: entry.id, original, match: { kind: "prompt", original: { id: original.id, normalized: original.normalized, spokenAt: original.spokenAt, latitude: original.latitude, longitude: original.longitude }, distanceMeters: entry.duplicateDistanceM ?? null, gapSeconds: entry.duplicateGapSec ?? 0, reason: "same-window" } });
        }} />)}</AnimatePresence>
        {entries.length > 80 && <p className="text-center text-[10px] text-muted-foreground">عرض أحدث 80 لوحة — الكل يظهر في تقرير الجلسة</p>}
        {entries.length === 0 && !recording && <div className="rounded-2xl bg-muted/30 p-6 text-center text-sm text-muted-foreground"><Info className="mx-auto mb-2 h-6 w-6" />اضغط زر الميكروفون وابدأ بنطق أرقام اللوحات</div>}
      </div>

      <AnimatePresence>{calibrating && <CalibrationSheet onClose={() => setCalibrating(false)} />}</AnimatePresence>
      <AnimatePresence>{preflightOpen && <GeoPreflightSheet loading={preflightLoading} result={preflight} onCancel={() => setPreflightOpen(false)} onContinue={confirmAndStart} onRetry={async () => { setPreflightLoading(true); try { setPreflight(await runGeoPreflight()); } finally { setPreflightLoading(false); } }} />}</AnimatePresence>
      <AnimatePresence>
        {duplicatePrompt && (
          <DuplicatePromptSheet
            entry={entriesRef.current.find((e) => e.id === duplicatePrompt.entryId) ?? null}
            original={duplicatePrompt.original}
            match={duplicatePrompt.match}
            onClose={() => setDuplicatePrompt(null)}
            onDecide={(decision) => {
              applyEntries(entriesRef.current.map((e) => e.id === duplicatePrompt.entryId ? { ...e, duplicateDecision: decision, duplicateOfId: decision === "different" ? null : e.duplicateOfId } : e));
              setDuplicatePrompt(null);
              toast(decision === "same" ? "تم دمجها كتكرار" : "تم تأكيدها كسيارة مختلفة");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CalibrationSheet({ onClose }: { onClose: () => void }) {
  const [level, setLevel] = useState(0);
  const [maxLevel, setMaxLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<RecorderHandle | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await startRecorder({ chunkSeconds: 60, targetSampleRate: 16000, onLevel: (l) => { if (cancelled) return; setLevel(l); setMaxLevel((m) => Math.max(m, l)); }, onChunk: () => undefined });
        handleRef.current = h;
        setRunning(true);
      } catch (e) { setError(e instanceof Error ? e.message : "تعذر فتح الميكروفون"); }
    })();
    return () => { cancelled = true; void handleRef.current?.stop(); handleRef.current = null; };
  }, []);
  const rating = maxLevel < 0.02 ? { label: "منخفض جداً — تحدّث بصوت أعلى أو قرّب الميكروفون", color: "text-destructive", bar: "bg-destructive" } : maxLevel < 0.06 ? { label: "مقبول — يفضّل التحدّث بصوت أوضح", color: "text-warning", bar: "bg-warning" } : maxLevel > 0.5 ? { label: "مرتفع جداً — أبعد الميكروفون قليلاً", color: "text-warning", bar: "bg-warning" } : { label: "ممتاز — جاهز للتسجيل", color: "text-success", bar: "bg-success" };
  const barPct = Math.min(100, Math.round(level * 350));
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm"><motion.div initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="w-full max-w-[440px] rounded-t-3xl bg-background p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-black">معايرة الميكروفون</h2><button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button></div><p className="mb-4 text-xs text-muted-foreground">تحدّث بصوتك الطبيعي لعدة ثوانٍ. راقب المؤشّر ليتأكد من وضوح الصوت.</p>{error ? <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div> : <><div className="mb-2 flex items-center gap-2"><Mic className={`h-5 w-5 ${running ? "text-primary" : "text-muted-foreground"}`} /><span className="text-xs font-bold">مستوى الصوت الحالي</span><span className="ml-auto text-xs tabular-nums text-muted-foreground">{barPct}%</span></div><div className="mb-4 h-4 overflow-hidden rounded-full bg-muted"><motion.div className={`h-full ${rating.bar}`} animate={{ width: `${barPct}%` }} transition={{ duration: 0.1 }} /></div><div className="mb-1 text-xs text-muted-foreground">أعلى قيمة مسجّلة: <span className="font-bold text-foreground tabular-nums">{Math.round(maxLevel * 350)}%</span></div><div className={`rounded-2xl border p-3 text-sm font-bold ${rating.color} ${running ? "border-current/30" : "border-transparent"}`}>{running ? rating.label : "جاري تشغيل الميكروفون..."}</div></>}<button onClick={onClose} className="mt-5 w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground">تم</button></motion.div></motion.div>;
}

function PerfPanel({ stats }: { stats: PerfStats }) {
  const slow = stats.avgTotalMs > 1500 || stats.queue > 2;
  return (
    <div className={`mb-3 rounded-2xl border p-2.5 ${slow ? "border-warning/40 bg-warning/5" : "border-primary/25 bg-primary/5"}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold">
        <Activity className={`h-3.5 w-3.5 ${slow ? "text-warning" : "text-primary"}`} />
        <span>أداء المعالجة</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">آخر {stats.count} تقطيع{stats.queue > 0 ? ` • قائمة انتظار ${stats.queue}` : ""}</span>
      </div>
      <div className="grid grid-cols-4 gap-1.5 text-center">
        <PerfCell label="فجوة" value={`${stats.avgChunkGapMs.toFixed(0)}`} unit="ms" />
        <PerfCell label="نص" value={`${stats.avgSttMs.toFixed(0)}`} unit="ms" />
        <PerfCell label="مطابقة" value={`${stats.avgMatchMs.toFixed(0)}`} unit="ms" />
        <PerfCell label="إجمالي" value={`${stats.avgTotalMs.toFixed(0)}`} unit="ms" highlight={slow} />
      </div>
    </div>
  );
}
function PerfCell({ label, value, unit, highlight }: { label: string; value: string; unit: string; highlight?: boolean }) {
  return <div className={`rounded-lg bg-background/70 p-1.5 ${highlight ? "text-warning" : ""}`}><p className="text-xs font-black tabular-nums">{value}<span className="text-[9px] font-normal text-muted-foreground">{unit}</span></p><p className="text-[9px] text-muted-foreground">{label}</p></div>;
}

const PlateCard = memo(function PlateCard({ entry, allEntries, onReopenDuplicate }: { entry: PlateEntry; allEntries?: PlateEntry[]; onReopenDuplicate?: (e: PlateEntry) => void }) {
  const [open, setOpen] = useState(false);
  const matched = !!entry.matchedPlate;
  const lettersSpaced = entry.letters.split("").join(" ");
  const digitsSpaced = entry.digits.split("").join(" ");
  const isDup = !!entry.duplicateOfId && entry.duplicateDecision === "same";
  const isUnresolved = !!entry.duplicateOfId && (entry.duplicateDecision === "unresolved" || !entry.duplicateDecision);
  const origIndex = entry.duplicateOfId && allEntries ? allEntries.findIndex((x) => x.id === entry.duplicateOfId) : -1;
  return (
    <motion.div initial={{ opacity: 0, x: -20, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 20 }} onClick={() => matched && setOpen((o) => !o)} className={`glass overflow-hidden rounded-2xl p-3 ${isDup ? "border border-primary/40 bg-primary/5 opacity-80" : isUnresolved ? "border border-primary/60 bg-primary/10 ring-2 ring-primary/30" : matched ? "border border-success/50 glow-success cursor-pointer" : !entry.complete ? "border border-warning/40" : "border border-border"}`}>
      {(isDup || isUnresolved) && (
        <div className="mb-2 flex items-center gap-1.5 rounded-lg bg-primary/15 px-2 py-1 text-[10.5px] font-bold text-primary">
          <Copy className="h-3 w-3" />
          {isDup ? "لوحة مُكرّرة" : "هل هي نفس السيارة؟"}
          <span className="text-muted-foreground">{formatGap(entry.duplicateGapSec ?? 0)}{entry.duplicateDistanceM != null ? ` • ${formatDistance(entry.duplicateDistanceM)}` : ""}</span>
          {origIndex >= 0 && <span className="text-muted-foreground">• #{allEntries!.length - origIndex}</span>}
          {isUnresolved && onReopenDuplicate && (
            <button onClick={(e) => { e.stopPropagation(); onReopenDuplicate(entry); }} className="ml-auto rounded-md bg-primary px-2 py-0.5 text-[10px] font-black text-primary-foreground">
              راجِع الآن
            </button>
          )}
          {isDup && onReopenDuplicate && (
            <button onClick={(e) => { e.stopPropagation(); onReopenDuplicate(entry); }} className="ml-auto rounded-md border border-primary/40 px-2 py-0.5 text-[10px] font-bold text-primary">تراجع</button>
          )}
        </div>
      )}
      <div className="flex items-start gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${matched ? "bg-success/20 text-success" : !entry.complete ? "bg-warning/20 text-warning" : "bg-muted"}`}>{matched ? <CheckCircle2 className="h-5 w-5" /> : !entry.complete ? <AlertTriangle className="h-5 w-5" /> : <Car className="h-5 w-5" />}</div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xl font-black tracking-[0.3em]"><span className="text-primary" dir="rtl">{lettersSpaced}</span><span className="mx-2 text-muted-foreground">—</span><span dir="ltr">{digitsSpaced}</span></p>
          <p className="text-[10px] text-muted-foreground">{matched ? "✓ مطابقة" : !entry.complete ? "غير مكتملة" : "غير موجودة بالقاعدة"} • {new Date(entry.spokenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{entry.confidence < 0.85 && ` • ثقة ${Math.round(entry.confidence * 100)}%`}</p>
          {entry.spokenText && <p className="mt-1 rounded-lg bg-muted/50 px-2 py-1 text-xs font-bold leading-5" dir="rtl">{entry.spokenText}</p>}
          {entry.suspectPart && <p className="mt-1 rounded-lg bg-warning/10 px-2 py-1 text-[10px] text-warning">⚠ جزء مشكوك: <span className="font-mono">{entry.suspectPart}</span>{entry.correctionNote && ` — ${entry.correctionNote}`}</p>}
          {!entry.complete && <MissingPlateParts entry={entry} />}
        </div>
      </div>
      <AnimatePresence>{open && matched && entry.matchedPlate && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden border-t border-border pt-3 text-xs"><Row label="النوع" value={entry.matchedPlate.car_type} /><Row label="البنك" value={entry.matchedPlate.bank} /><Row label="الهيكل" value={entry.matchedPlate.chassis} /><Row label="التاريخ" value={entry.matchedPlate.plate_date} /></motion.div>}</AnimatePresence>
    </motion.div>
  );
}, (prev, next) => {
  const a = prev.entry, b = next.entry;
  return a.id === b.id && a.digits === b.digits && a.letters === b.letters && a.complete === b.complete && !!a.matchedPlate === !!b.matchedPlate && a.spokenText === b.spokenText && a.correctionNote === b.correctionNote && a.duplicateDecision === b.duplicateDecision && a.duplicateOfId === b.duplicateOfId;
});

function MissingPlateParts({ entry }: { entry: PlateEntry }) {
  const letters = entry.letters.split("");
  const digits = entry.digits.split("");
  return <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]"><span className="text-muted-foreground">الناقص:</span>{[0, 1, 2].map((i) => <span key={`l${i}`} className={`grid h-6 w-6 place-items-center rounded-md border font-mono font-black ${letters[i] ? "border-primary/30 bg-primary/10 text-primary" : "border-warning/40 bg-warning/15 text-warning"}`}>{letters[i] ?? "ح"}</span>)}<span className="mx-1 text-muted-foreground">—</span>{[0, 1, 2, 3].map((i) => <span key={`d${i}`} className={`grid h-6 w-6 place-items-center rounded-md border font-mono font-black ${digits[i] ? "border-foreground/15 bg-muted/50" : "border-warning/40 bg-warning/15 text-warning"}`}>{digits[i] ?? "#"}</span>)}{entry.closestPlate && <span className="basis-full text-warning">أقرب بديل: {entry.closestPlate.raw}</span>}</div>;
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return <div className="flex justify-between gap-3 py-1"><span className="text-muted-foreground">{label}</span><span className="text-left font-mono">{value}</span></div>;
}

function LiveStatusBar({ processing, transcript, lastCapture, level }: { processing: boolean; transcript: string; lastCapture: { raw: string; complete: boolean; matched: boolean; at: number } | null; level: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 300); return () => clearInterval(iv); }, []);
  const recent = lastCapture && now - lastCapture.at < 2500 ? lastCapture : null;
  const state: "captured" | "transcribing" | "listening" = recent ? "captured" : processing ? "transcribing" : "listening";
  const tone = state === "captured" ? recent!.matched ? { pill: "bg-success/20 text-success border-success/40", bar: "bg-success" } : recent!.complete ? { pill: "bg-primary/20 text-primary border-primary/40", bar: "bg-primary" } : { pill: "bg-warning/20 text-warning border-warning/40", bar: "bg-warning" } : state === "transcribing" ? { pill: "bg-primary/15 text-primary border-primary/30", bar: "bg-primary" } : { pill: "bg-muted text-muted-foreground border-border", bar: "bg-primary/60" };
  const label = state === "captured" ? recent!.matched ? `تطابق: ${recent!.raw}` : recent!.complete ? `التقطت: ${recent!.raw}` : `ناقصة: ${recent!.raw}` : state === "transcribing" ? "جاري التعرّف على الصوت..." : "الاستماع — تحدّث بأرقام اللوحة";
  const Icon = state === "captured" ? (recent!.matched ? CheckCircle2 : recent!.complete ? Sparkles : AlertTriangle) : state === "transcribing" ? Loader2 : Radio;
  const barPct = state === "transcribing" ? undefined : Math.min(100, Math.round(level * 350));
  return <div className="mb-3 overflow-hidden rounded-2xl border border-border p-2.5"><div className="flex items-center gap-2"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone.pill}`}><Icon className={`h-3.5 w-3.5 ${state === "transcribing" ? "animate-spin" : ""}`} />{label}</span>{transcript && <span className="ml-auto truncate text-[10.5px] text-muted-foreground" dir="rtl">{transcript.slice(-80)}</span>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/60">{state === "transcribing" ? <motion.div className={`h-full ${tone.bar}`} initial={{ x: "-40%", width: "40%" }} animate={{ x: "100%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }} /> : <motion.div className={`h-full ${tone.bar}`} animate={{ width: `${barPct}%` }} transition={{ duration: 0.15 }} />}</div></div>;
}

function VoiceDiagnostics({ status, level }: { status: VoiceStatus; level: number }) {
  const tone = status.mode === "error"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : status.mode === "recovering" || status.mode === "low"
      ? "border-warning/40 bg-warning/10 text-warning"
      : status.mode === "queued"
        ? "border-primary/35 bg-primary/10 text-primary"
        : "border-success/30 bg-success/10 text-success";
  const pct = Math.min(100, Math.round(level * 350));
  return (
    <div className={`mb-3 rounded-2xl border p-2.5 ${tone}`}>
      <div className="flex items-center gap-2 text-[11px] font-bold">
        {status.mode === "recovering" || status.mode === "queued" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status.mode === "error" || status.mode === "low" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
        <span>{status.message}</span>
        <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[9.5px] text-muted-foreground">
        <div className="rounded-lg bg-background/60 px-1.5 py-1">طابور <b className="text-foreground tabular-nums">{status.queue}</b></div>
        <div className="rounded-lg bg-background/60 px-1.5 py-1">إعادة <b className="text-foreground tabular-nums">{status.restarts}</b></div>
        <div className="rounded-lg bg-background/60 px-1.5 py-1">أخطاء <b className="text-foreground tabular-nums">{status.errors}</b></div>
      </div>
    </div>
  );
}

function toMatched(p: PlateInfo): PlateEntry["matchedPlate"] {
  return { plate_raw: p.plate_raw, bank: p.bank, car_type: p.car_type, chassis: p.chassis, plate_date: p.plate_date };
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

// (haversine is now provided by @/lib/geo)

function GeoDeniedBanner({ onRetry }: { onRetry: () => void }) {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const hint = isAndroid
    ? "افتح إعدادات الهاتف ← التطبيقات ← PlateCheck ← الأذونات ← الموقع ← السماح دائماً"
    : isIOS
      ? "افتح الإعدادات ← الخصوصية والأمان ← خدمات الموقع ← Safari/PlateCheck ← السماح أثناء الاستخدام"
      : "افتح إعدادات المتصفح للموقع الحالي وفعّل إذن الموقع (Location) ثم اضغط إعادة المحاولة";
  return (
    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3">
      <div className="mb-1 flex items-center gap-2 text-sm font-black text-destructive">
        <MapPinOff className="h-4 w-4" /> إذن الموقع مرفوض
      </div>
      <p className="mb-2 text-[11px] leading-5 text-muted-foreground">{hint}</p>
      <button onClick={onRetry} className="inline-flex items-center gap-1 rounded-lg bg-destructive px-3 py-1.5 text-[11px] font-bold text-destructive-foreground">
        <MapPin className="h-3 w-3" /> إعادة طلب الإذن
      </button>
    </div>
  );
}

function missingPartsLabel(p: DetectedPlate): string | undefined {
  const missing: string[] = [];
  if (p.letters.length < 3) missing.push(`${3 - p.letters.length} حرف`);
  if (p.digits.length < 4) missing.push(`${4 - p.digits.length} رقم`);
  return missing.length ? `ينقص ${missing.join(" و ")}` : undefined;
}

async function readTranscriptionStream(body: ReadableStream<Uint8Array>, onPartial: (text: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let partial = "";
  let final = "";
  let lastEmit = 0;

  const consumeLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    try {
      const event = JSON.parse(payload) as { type?: string; delta?: string; text?: string };
      if (event.type === "transcript.text.delta" && event.delta) {
        partial += event.delta;
        const now = Date.now();
        const cleaned = cleanRecognizedText(partial);
        if (cleaned.length >= 2 && now - lastEmit > 220) {
          lastEmit = now;
          onPartial(cleaned);
        }
      } else if (event.type === "transcript.text.done" && event.text) {
        final = event.text;
      }
    } catch {
      // Ignore malformed SSE keepalive lines.
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
  }
  if (buffer) consumeLine(buffer);
  return cleanRecognizedText(final || partial);
}

function rebuildDedupState(entries: PlateEntry[], growable: Map<string, { entryId: string; digits: string; at: number; normalized: string }>, finalized: Map<string, number>) {
  growable.clear();
  finalized.clear();
  for (const e of entries) {
    if (e.complete) finalized.set(e.normalized, e.spokenAt);
    else growable.set(e.letters, { entryId: e.id, digits: e.digits, at: e.spokenAt, normalized: e.normalized });
  }
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function findClosestPlate(input: string, list: PlateInfo[]): { raw: string; score: number } | null {
  if (!input || list.length === 0) return null;
  let best: { raw: string; score: number } | null = null;
  for (const p of list.slice(0, 5000)) {
    const distance = levenshtein(input, p.plate_normalized);
    const score = 1 - distance / Math.max(input.length, p.plate_normalized.length, 1);
    if (!best || score > best.score) best = { raw: p.plate_raw, score };
  }
  return best && best.score >= 0.55 ? best : null;
}
function GeoPreflightSheet({ loading, result, onCancel, onContinue, onRetry }: { loading: boolean; result: GeoPreflight | null; onCancel: () => void; onContinue: () => void; onRetry: () => void }) {
  const android = isAndroid();
  const canContinue = !!result && result.permission === "granted" && !!result.probe;
  const showBgWarn = !!result && result.native && !result.backgroundAvailable;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="w-full max-w-[440px] rounded-t-3xl bg-background p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">فحص GPS قبل التسجيل</h2>
          <button onClick={onCancel} className="grid h-8 w-8 place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        {loading || !result ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جاري الفحص...</div>
        ) : (
          <div className="space-y-2 text-xs">
            <PreflightRow ok={result.supported} label="GPS مدعوم على الجهاز" bad="غير مدعوم" />
            <PreflightRow ok={result.permission === "granted"} label="إذن الموقع ممنوح" bad={result.permission === "denied" ? "مرفوض" : "بانتظار الإذن"} />
            <PreflightRow ok={!!result.probe} label={result.probe ? `إشارة GPS نشطة (دقة ${result.probe.acc.toFixed(0)}م)` : "لا توجد إشارة GPS"} bad={result.probeError ?? "تعذر قراءة الموقع"} />
            <PreflightRow ok={result.highAccuracy} label="الدقة العالية مفعّلة" warn={!result.highAccuracy ? "الدقة المنخفضة — فعّل الوضع الدقيق في إعدادات الموقع" : undefined} />
            {result.native && <PreflightRow ok={result.backgroundAvailable} label={result.backgroundAvailable ? "تتبع الخلفية متاح" : "تتبع الخلفية غير مثبّت"} warn={showBgWarn ? "ثبّت @capacitor-community/background-geolocation لبقاء GPS شغالاً في الخلفية" : undefined} />}
            {android && result.permission === "granted" && !result.highAccuracy && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-[11px] leading-5 text-warning">
                <b>لرفع الدقة على Android:</b> الإعدادات ← الموقع ← الوضع ← "دقة عالية" (GPS + Wi-Fi + شبكات). فعّل خدمة Google Location Accuracy إن وُجدت.
              </div>
            )}
            {result.permission === "denied" && (
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-[11px] leading-5 text-destructive">
                {android ? "الإعدادات ← التطبيقات ← PlateCheck ← الأذونات ← الموقع ← السماح دائماً" : "افتح إعدادات المتصفح ← الموقع ← السماح لهذا التطبيق"}
              </div>
            )}
            {result.native && !result.backgroundAvailable && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 text-[11px] leading-5">
                عند إغلاق شاشة الجهاز أثناء الجلسة سيتوقف GPS. لتفعيل الخلفية على Android نفّذ:
                <br/><code className="mt-1 inline-block rounded bg-background/70 px-1.5 py-0.5">npm install @capacitor-community/background-geolocation</code> ثم <code className="rounded bg-background/70 px-1.5 py-0.5">npx cap sync android</code>
              </div>
            )}
          </div>
        )}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onRetry} disabled={loading} className="rounded-2xl bg-muted py-3 text-sm font-black disabled:opacity-50">إعادة الفحص</button>
          <button onClick={onContinue} disabled={loading || !canContinue} className="rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-50">
            {canContinue ? "متابعة وبدء التسجيل" : "متابعة بدون GPS"}
          </button>
        </div>
        {!canContinue && !loading && (
          <button onClick={onContinue} className="mt-2 w-full text-[11px] text-muted-foreground underline">تجاهل والبدء بدون تتبع الموقع</button>
        )}
      </motion.div>
    </motion.div>
  );
}

function PreflightRow({ ok, label, bad, warn }: { ok: boolean; label: string; bad?: string; warn?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border p-2.5 ${ok ? "border-success/30 bg-success/5" : warn ? "border-warning/30 bg-warning/5" : "border-destructive/30 bg-destructive/5"}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${warn ? "text-warning" : "text-destructive"}`} />}
      <div className="min-w-0">
        <p className="font-bold">{label}</p>
        {!ok && (bad || warn) && <p className={`text-[10.5px] ${warn ? "text-warning" : "text-destructive"}`}>{warn ?? bad}</p>}
      </div>
    </div>
  );
}

function DuplicatePromptSheet({ entry, original, match, onClose, onDecide }: { entry: PlateEntry | null; original: PlateEntry; match: DuplicateMatch; onClose: () => void; onDecide: (d: "same" | "different") => void }) {
  if (!entry) return null;
  const plate = `${entry.letters}-${entry.digits}`;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <motion.div initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", stiffness: 320, damping: 32 }} className="w-full max-w-[440px] rounded-t-3xl bg-background p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary"><HelpCircle className="h-5 w-5" /></div>
            <h2 className="text-lg font-black">هل هي نفس السيارة؟</h2>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-3 rounded-xl bg-muted/40 p-3 text-center font-mono text-xl font-black tracking-[0.3em]" dir="ltr">{plate}</p>
        <div className="mb-4 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-xl border border-border p-2.5">
            <p className="text-[10px] text-muted-foreground">الفاصل الزمني</p>
            <p className="text-sm font-black tabular-nums">{formatGap(match.gapSeconds)}</p>
          </div>
          <div className="rounded-xl border border-border p-2.5">
            <p className="text-[10px] text-muted-foreground">المسافة</p>
            <p className="text-sm font-black tabular-nums">{match.distanceMeters != null ? formatDistance(match.distanceMeters) : "—"}</p>
          </div>
        </div>
        <p className="mb-3 text-[11px] leading-5 text-muted-foreground">تم رصد نفس اللوحة سابقاً في هذه الجلسة. لو نفس السيارة سنعتبرها تكراراً ولن تُحسب مرتين في التقرير.</p>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => onDecide("different")} className="flex items-center justify-center gap-1.5 rounded-2xl border-2 border-border bg-background py-3 text-sm font-black">
            <Car className="h-4 w-4" /> سيارة مختلفة
          </button>
          <button onClick={() => onDecide("same")} className="flex items-center justify-center gap-1.5 rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground">
            <GitMerge className="h-4 w-4" /> نفس السيارة
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
