import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback, memo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, CheckCircle2, AlertTriangle, Loader2, Info, Car, Settings2, X, Radio, Sparkles, MapPin, MapPinOff, FileText, Save, Trash2, Activity } from "lucide-react";
import { startRecorder, type RecorderHandle } from "@/lib/audio-recorder";
import { extractPlates, plateAppearsInText, type DetectedPlate } from "@/lib/plate-utils";
import { TrackingMap } from "@/components/TrackingMap";
import { checkGeoPermission, requestGeoPermission, watchGeo, shouldAcceptPoint, smoothPath, runGeoPreflight, isAndroid, type GeoPoint, type WatchHandle, type PermissionState, type GeoPreflight } from "@/lib/geo";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
}

interface DraftSession {
  draftId: string;
  userId: string;
  startedAt: number;
  entries: PlateEntry[];
  transcript: string;
  path: GeoPoint[];
  wasRecording: boolean;
  reviewOpen?: boolean;
}

const DRAFT_KEY = "platecheck.active-recording-draft.v4";

function RecordPage() {
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: isAdmin });

  const { data: platesIndex, isLoading: platesLoading } = useQuery({
    queryKey: ["plates-index"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { map: new Map<string, PlateInfo>(), list: [] as PlateInfo[], count: 0 };
      const map = new Map<string, PlateInfo>();
      const list: PlateInfo[] = [];
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
        for (const p of data) {
          map.set(p.plate_normalized, p);
          list.push(p);
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return { map, list, count: map.size };
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
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [savedSessionId, setSavedSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastCapture, setLastCapture] = useState<{ raw: string; complete: boolean; matched: boolean; at: number } | null>(null);
  const [geoOn, setGeoOn] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [geoPerm, setGeoPerm] = useState<PermissionState>("prompt");
  const [path, setPath] = useState<GeoPoint[]>([]);
  const [preflight, setPreflight] = useState<GeoPreflight | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);

  const currentPosRef = useRef<GeoPoint | null>(null);
  const geoWatchRef = useRef<WatchHandle | null>(null);
  const rawPathRef = useRef<GeoPoint[]>([]);
  // (path throttling now handled inside geo.ts via shouldAcceptPoint)
  const pathRef = useRef<GeoPoint[]>([]);
  const recorderRef = useRef<RecorderHandle | null>(null);
  const processChunkRef = useRef<(wav: Blob) => void>(() => undefined);
  const pendingRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const entriesRef = useRef<PlateEntry[]>([]);
  const growableRef = useRef<Map<string, { entryId: string; digits: string }>>(new Map());
  const finalizedRef = useRef<Map<string, number>>(new Map());
  const restoredRef = useRef(false);
  const perfBufferRef = useRef<PerfSample[]>([]);
  const lastChunkAtRef = useRef<number>(0);
  const [perfStats, setPerfStats] = useState<PerfStats>({ count: 0, avgChunkGapMs: 0, avgSttMs: 0, avgParseMs: 0, avgMatchMs: 0, avgTotalMs: 0, lastLagMs: 0, queue: 0 });
  const draftSaveTimerRef = useRef<number | null>(null);

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
    startGeoTracking();
    recorderRef.current = await startRecorder({
      chunkSeconds: 1.05,
      overlapSeconds: 0.85,
      targetSampleRate: 16000,
      onLevel: setLevel,
      onChunk: (wav) => processChunkRef.current(wav),
    });
    setRecording(true);
  }, []);

  useEffect(() => {
    if (!startedAt || !sessionId) return;
    if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(() => {
      const draft: DraftSession = { draftId: sessionId, userId: "", startedAt, entries, transcript, path, wasRecording: recording, reviewOpen };
      supabase.auth.getUser().then(({ data }) => {
        draft.userId = data.user?.id ?? "";
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) { console.warn("draft save failed", e); }
      }).catch(() => undefined);
    }, 600);
    return () => { if (draftSaveTimerRef.current) window.clearTimeout(draftSaveTimerRef.current); };
  }, [entries, path, recording, reviewOpen, sessionId, startedAt, transcript]);

  useEffect(() => {
    if (restoredRef.current || platesLoading) return;
    restoredRef.current = true;
    (async () => {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as DraftSession;
      if (!draft?.draftId || !draft.startedAt || Date.now() - draft.startedAt > 12 * 60 * 60 * 1000) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (draft.userId && data.user?.id && draft.userId !== data.user.id) return;
      sessionIdRef.current = draft.draftId;
      setSessionId(draft.draftId);
      setStartedAt(draft.startedAt);
      setElapsed(Math.floor((Date.now() - draft.startedAt) / 1000));
      setTranscript(draft.transcript ?? "");
      setPath(draft.path ?? []);
      pathRef.current = draft.path ?? [];
      applyEntries(draft.entries ?? []);
      setReviewOpen(!!draft.reviewOpen);
      rebuildDedupState(draft.entries ?? [], growableRef.current, finalizedRef.current);
      if (draft.wasRecording && !draft.reviewOpen) {
        toast.info("تم استكمال الجلسة المفتوحة بعد تحديث الصفحة");
        await startCapture();
      }
    })().catch((e) => console.error("restore draft", e));
  }, [applyEntries, platesLoading, startCapture]);

  const processChunk = useCallback(async (wav: Blob) => {
    pendingRef.current++;
    setProcessing(true);
    const t0 = performance.now();
    const chunkGap = lastChunkAtRef.current ? t0 - lastChunkAtRef.current : 0;
    lastChunkAtRef.current = t0;
    let sttMs = 0, parseMs = 0, matchMs = 0, textLen = 0;
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token || !sessionIdRef.current) return;
      const form = new FormData();
      form.append("audio", wav, "chunk.wav");
      const tStt = performance.now();
      const res = await fetch("/api/transcribe", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
      if (!res.ok) {
        console.error("STT", res.status, await res.text().catch(() => ""));
        return;
      }
      const json = await res.json();
      sttMs = performance.now() - tStt;
      const text: string = (json.text || "").trim();
      textLen = text.length;
      if (!text || text.length < 2) return;
      setTranscript((prev) => (prev + " " + text).trim().slice(-3000));
      const tParse = performance.now();
      const plates = extractPlates(text);
      parseMs = performance.now() - tParse;
      if (plates.length === 0) return;
      const tMatch = performance.now();

      for (const p of plates) {
        if (!p.complete && !plateAppearsInText(p.letters, p.digits, text)) continue;
        const match = platesIndex?.map.get(p.normalized);
        const isMatched = !!match && p.complete && p.confidence >= 0.85;
        const closest = !isMatched ? findClosestPlate(p.normalized, platesIndex?.list ?? []) : null;
        const enriched: DetectedPlate = {
          ...p,
          suspectPart: p.suspectPart ?? missingPartsLabel(p),
          correctionNote: p.correctionNote ?? (closest ? `أقرب بديل في Excel: ${closest.raw} بنسبة ${Math.round(closest.score * 100)}%` : undefined),
        };
        const now = Date.now();
        const key = enriched.letters;
        const existing = growableRef.current.get(key);
        if (existing) {
          if (enriched.digits.length <= existing.digits.length) continue;
          applyEntries(entriesRef.current.map((e) => e.id === existing.entryId ? {
            ...e,
            ...enriched,
            spokenText: `${e.spokenText} ${text}`.trim().slice(-700),
            matchedPlateId: isMatched ? match!.id : null,
            closestPlate: closest,
            matchedPlate: isMatched ? toMatched(match!) : undefined,
          } : e));
          setLastCapture({ raw: enriched.raw, complete: enriched.complete, matched: isMatched, at: now });
          if (enriched.complete) {
            growableRef.current.delete(key);
            finalizedRef.current.set(enriched.normalized, now);
            if (isMatched) {
              if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
              toast.success(`تطابق: ${enriched.raw}`, { description: match!.car_type || undefined });
            }
          } else {
            growableRef.current.set(key, { ...existing, digits: enriched.digits });
          }
          continue;
        }

        const lastSame = finalizedRef.current.get(enriched.normalized);
        if (lastSame && now - lastSame < 9000) continue;
        const pos = currentPosRef.current;
        const entry: PlateEntry = {
          ...enriched,
          id: crypto.randomUUID(),
          spokenAt: now,
          spokenText: text,
          matchedPlateId: isMatched ? match!.id : null,
          closestPlate: closest,
          latitude: pos?.lat ?? null,
          longitude: pos?.lng ?? null,
          matchedPlate: isMatched ? toMatched(match!) : undefined,
        };
        applyEntries([entry, ...entriesRef.current].slice(0, 500));
        setLastCapture({ raw: enriched.raw, complete: enriched.complete, matched: isMatched, at: now });
        if (enriched.complete) {
          finalizedRef.current.set(enriched.normalized, now);
          if (isMatched) {
            if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
            toast.success(`تطابق: ${enriched.raw}`, { description: match!.car_type || undefined });
          }
        } else {
          growableRef.current.set(key, { entryId: entry.id, digits: enriched.digits });
        }
      }
      matchMs = performance.now() - tMatch - parseMs > 0 ? performance.now() - (t0 + sttMs + parseMs) : 0;
    } catch (err) {
      console.error(err);
    } finally {
      const totalMs = performance.now() - t0;
      const sample: PerfSample = { chunkGapMs: chunkGap, sttMs, parseMs, matchMs: Math.max(0, totalMs - sttMs - parseMs), totalMs, textLen, at: Date.now() };
      const buf = perfBufferRef.current;
      buf.push(sample);
      if (buf.length > PERF_BUFFER_SIZE) buf.shift();
      setPerfStats(computePerfStats(buf, pendingRef.current - 1));
      if (import.meta.env.DEV) console.debug("[perf]", { gap: `${sample.chunkGapMs.toFixed(0)}ms`, stt: `${sttMs.toFixed(0)}ms`, parse: `${parseMs.toFixed(0)}ms`, total: `${totalMs.toFixed(0)}ms`, textLen, queue: pendingRef.current - 1 });
      pendingRef.current--;
      if (pendingRef.current === 0) setProcessing(false);
    }
  }, [applyEntries, platesIndex]);

  useEffect(() => {
    processChunkRef.current = (wav: Blob) => { void processChunk(wav); };
  }, [processChunk]);

  async function ensureGeoPermission(): Promise<PermissionState> {
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
  }

  async function startGeoTracking() {
    if (geoWatchRef.current) return;
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
        if (!shouldAcceptPoint(prev, pt, { speed, bufferSize: rawPathRef.current.length })) return;
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
  }

  function stopGeoTracking() {
    if (geoWatchRef.current) {
      void geoWatchRef.current.stop();
      geoWatchRef.current = null;
    }
    setGeoOn(false);
  }

  async function beginSession() {
    if (!platesIndex || platesIndex.count === 0) {
      toast.warning("قم برفع ملف Excel أولاً");
      return;
    }
    // GPS pre-flight before opening the mic — makes background/permission
    // issues visible before the user starts talking.
    setPreflightLoading(true);
    setPreflightOpen(true);
    try {
      const pf = await runGeoPreflight();
      setPreflight(pf);
    } finally {
      setPreflightLoading(false);
    }
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
      setSessionId(draftId);
      setSavedSessionId(null);
      applyEntries([]);
      setTranscript("");
      setPath([]);
      pathRef.current = [];
      currentPosRef.current = null;
      rawPathRef.current = [];
      setReviewOpen(false);
      setStartedAt(Date.now());
      setElapsed(0);
      await startCapture();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "تعذر بدء التسجيل");
    }
  }

  async function stopRecording() {
    setRecording(false);
    await recorderRef.current?.stop();
    recorderRef.current = null;
    stopGeoTracking();
    const waitStart = Date.now();
    while (pendingRef.current > 0 && Date.now() - waitStart < 8000) await new Promise((r) => setTimeout(r, 200));
    if (sessionIdRef.current) {
      setReviewOpen(true);
      const current = entriesRef.current;
      const incomplete = current.filter((e) => !e.complete).length;
      toast.info(`المعاينة جاهزة — ${current.length} لوحة قبل الحفظ النهائي`);
      if (incomplete > 0) toast.warning(`${incomplete} لوحة غير مكتملة — راجع السبب في المعاينة`, { duration: 6000 });
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
      const first = pathRef.current[0];
      const { data: saved, error } = await supabase
        .from("recognition_sessions")
        .insert({
          user_id: u.user.id,
          started_at: new Date(startedAt).toISOString(),
          ended_at: new Date().toISOString(),
          total_detected: current.length,
          total_matched: matched,
          total_incomplete: incomplete,
          path: pathRef.current as unknown as never,
          start_latitude: first?.lat ?? null,
          start_longitude: first?.lng ?? null,
          notes: transcript.slice(0, 1800),
        })
        .select("id")
        .single();
      if (error || !saved) throw error ?? new Error("تعذر حفظ الجلسة");
      if (current.length > 0) {
        const rows = [...current].reverse().map((e) => ({
          session_id: saved.id,
          user_id: u.user!.id,
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
        }));
        const { error: rowsErr } = await supabase.from("detected_plates").insert(rows);
        if (rowsErr) throw rowsErr;
      }
      localStorage.removeItem(DRAFT_KEY);
      setSavedSessionId(saved.id);
      setSessionId(null);
      sessionIdRef.current = null;
      setReviewOpen(false);
      setStartedAt(null);
      toast.success(`تم حفظ الجلسة — ${current.length} لوحة، ${matched} مطابقة`);
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
    setStartedAt(null);
    setReviewOpen(false);
    setTranscript("");
    applyEntries([]);
    setPath([]);
    pathRef.current = [];
    toast.success("تم حذف المسودة");
  }

  function exportCurrentPDF() {
    const current = entriesRef.current;
    const doc = new jsPDF({ orientation: "portrait", unit: "pt" });
    doc.setFontSize(14);
    doc.text(`Current Session Preview - ${new Date(startedAt ?? Date.now()).toLocaleString()}`, 40, 40);
    doc.setFontSize(10);
    doc.text(`Duration: ${formatTime(elapsed)} | Total: ${current.length} | Matched: ${current.filter((e) => e.matchedPlate).length} | Incomplete: ${current.filter((e) => !e.complete).length}`, 40, 60);
    if (transcript) doc.text(`Transcript: ${transcript.slice(-900)}`, 40, 78, { maxWidth: 520 });
    autoTable(doc, {
      startY: transcript ? 122 : 86,
      head: [["#", "Plate", "Status", "Spoken Text", "Note", "Lat", "Lng"]],
      body: [...current].reverse().map((e, i) => [i + 1, e.raw, e.matchedPlate ? "MATCH" : !e.complete ? "INCOMPLETE" : "NOT FOUND", e.spokenText, e.correctionNote ?? e.suspectPart ?? "", e.latitude?.toFixed(5) ?? "", e.longitude?.toFixed(5) ?? ""]),
      styles: { fontSize: 7, cellWidth: "wrap" },
      headStyles: { fillColor: [30, 100, 180] },
    });
    doc.save(`current-session-${Date.now()}.pdf`);
  }

  useEffect(() => () => { void recorderRef.current?.stop(); stopGeoTracking(); }, []);

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
        <button onClick={recording ? stopRecording : beginSession} disabled={!!notActive || platesLoading || reviewOpen} className={`relative grid h-40 w-40 place-items-center rounded-full transition-all disabled:opacity-40 ${recording ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground glow-primary"}`}>
          {recording && <><motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.4 + level * 4], opacity: [0.6, 0] }} transition={{ duration: 1.5, repeat: Infinity }} /><motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.8 + level * 4], opacity: [0.4, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }} /></>}
          {recording ? <Square className="h-16 w-16" strokeWidth={2.5} fill="currentColor" /> : <Mic className="h-16 w-16" strokeWidth={2.5} />}
        </button>
        <p className="mt-4 text-lg font-black">{recording || startedAt ? formatTime(elapsed) : "اضغط للبدء"}</p>
        {processing && <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> جاري التعرّف...</p>}
        {!recording && !reviewOpen && <button onClick={() => setCalibrating(true)} disabled={!!notActive} className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40"><Settings2 className="h-3 w-3" /> معايرة الميكروفون</button>}
      </div>

      {recording && <LiveStatusBar processing={processing} transcript={transcript} lastCapture={lastCapture} level={level} />}

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

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="glass rounded-xl p-2"><p className="text-lg font-black">{entries.length}</p><p className="text-[10px] text-muted-foreground">مكتشفة</p></div>
        <div className="glass rounded-xl p-2 border border-success/40"><p className="text-lg font-black text-success">{entries.filter((e) => e.matchedPlate).length}</p><p className="text-[10px] text-muted-foreground">مطابقة</p></div>
        <div className="glass rounded-xl p-2 border border-warning/40"><p className="text-lg font-black text-warning">{entries.filter((e) => !e.complete).length}</p><p className="text-[10px] text-muted-foreground">غير مكتملة</p></div>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-border bg-card/70 p-2"><p className="text-sm font-black tabular-nums">{reliability?.sessions ?? 0}</p><p className="text-[9.5px] text-muted-foreground">آخر جلسات</p></div>
        <div className="rounded-xl border border-primary/25 bg-primary/5 p-2"><p className="text-sm font-black tabular-nums text-primary">{reliability?.avgDetectSec ? `${reliability.avgDetectSec.toFixed(1)}ث` : "—"}</p><p className="text-[9.5px] text-muted-foreground">متوسط الكشف</p></div>
        <div className="rounded-xl border border-success/25 bg-success/5 p-2"><p className="text-sm font-black tabular-nums text-success">{reliability?.matchRate ? `${Math.round(reliability.matchRate * 100)}%` : "—"}</p><p className="text-[9.5px] text-muted-foreground">معدل التطابق</p></div>
      </div>

      {recording && perfStats.count > 0 && <PerfPanel stats={perfStats} />}

      {!recording && savedSessionId && entries.length > 0 && <Link to="/sessions/$id" params={{ id: savedSessionId }} className="mb-3 block rounded-2xl bg-primary p-3 text-center text-sm font-bold text-primary-foreground">عرض تقرير الجلسة</Link>}
      {!recording && reviewOpen && <SessionPreview entries={entries} transcript={transcript} elapsed={elapsed} saving={saving} onSave={saveReviewedSession} onDiscard={discardDraft} onDownload={exportCurrentPDF} />}

      <div className="flex-1 space-y-2 pb-4">
        <AnimatePresence initial={false}>{entries.slice(0, 80).map((e) => <PlateCard key={e.id} entry={e} />)}</AnimatePresence>
        {entries.length > 80 && <p className="text-center text-[10px] text-muted-foreground">عرض أحدث 80 لوحة — الكل يظهر في تقرير الجلسة</p>}
        {entries.length === 0 && !recording && <div className="rounded-2xl bg-muted/30 p-6 text-center text-sm text-muted-foreground"><Info className="mx-auto mb-2 h-6 w-6" />اضغط زر الميكروفون وابدأ بنطق أرقام اللوحات</div>}
      </div>

      <AnimatePresence>{calibrating && <CalibrationSheet onClose={() => setCalibrating(false)} />}</AnimatePresence>
      <AnimatePresence>{preflightOpen && <GeoPreflightSheet loading={preflightLoading} result={preflight} onCancel={() => setPreflightOpen(false)} onContinue={confirmAndStart} onRetry={async () => { setPreflightLoading(true); try { setPreflight(await runGeoPreflight()); } finally { setPreflightLoading(false); } }} />}</AnimatePresence>
    </div>
  );
}

function SessionPreview({ entries, transcript, elapsed, saving, onSave, onDiscard, onDownload }: { entries: PlateEntry[]; transcript: string; elapsed: number; saving: boolean; onSave: () => void; onDiscard: () => void; onDownload: () => void }) {
  const matched = entries.filter((e) => e.matchedPlate).length;
  const incomplete = entries.filter((e) => !e.complete).length;
  return (
    <div className="mb-4 rounded-3xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-base font-black">معاينة قبل الحفظ</h2><p className="text-[11px] text-muted-foreground">راجع النص والتطابقات ثم احفظ الجلسة نهائياً</p></div><span className="rounded-full bg-background px-2.5 py-1 text-[10px] font-bold tabular-nums">{formatTime(elapsed)}</span></div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center"><div className="rounded-xl bg-background/70 p-2"><p className="font-black">{entries.length}</p><p className="text-[9px] text-muted-foreground">مكتشفة</p></div><div className="rounded-xl bg-success/10 p-2"><p className="font-black text-success">{matched}</p><p className="text-[9px] text-muted-foreground">مطابقة</p></div><div className="rounded-xl bg-warning/10 p-2"><p className="font-black text-warning">{incomplete}</p><p className="text-[9px] text-muted-foreground">ناقصة</p></div></div>
      <div className="mb-3 max-h-24 overflow-auto rounded-2xl bg-background/70 p-3 text-xs leading-6 text-muted-foreground" dir="rtl">{transcript || "لا يوجد نص مسجل"}</div>
      <div className="grid grid-cols-3 gap-2"><button onClick={onDownload} className="inline-flex items-center justify-center gap-1 rounded-xl bg-background px-2 py-2 text-[11px] font-bold"><FileText className="h-3.5 w-3.5" /> PDF</button><button onClick={onDiscard} className="inline-flex items-center justify-center gap-1 rounded-xl bg-destructive/15 px-2 py-2 text-[11px] font-bold text-destructive"><Trash2 className="h-3.5 w-3.5" /> حذف</button><button onClick={onSave} disabled={saving} className="inline-flex items-center justify-center gap-1 rounded-xl bg-primary px-2 py-2 text-[11px] font-bold text-primary-foreground disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} حفظ</button></div>
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

const PlateCard = memo(function PlateCard({ entry }: { entry: PlateEntry }) {
  const [open, setOpen] = useState(false);
  const matched = !!entry.matchedPlate;
  const lettersSpaced = entry.letters.split("").join(" ");
  const digitsSpaced = entry.digits.split("").join(" ");
  return <motion.div initial={{ opacity: 0, x: -20, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 20 }} onClick={() => matched && setOpen((o) => !o)} className={`glass overflow-hidden rounded-2xl p-3 ${matched ? "border border-success/50 glow-success cursor-pointer" : !entry.complete ? "border border-warning/40" : "border border-border"}`}><div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${matched ? "bg-success/20 text-success" : !entry.complete ? "bg-warning/20 text-warning" : "bg-muted"}`}>{matched ? <CheckCircle2 className="h-5 w-5" /> : !entry.complete ? <AlertTriangle className="h-5 w-5" /> : <Car className="h-5 w-5" />}</div><div className="min-w-0 flex-1"><p className="font-mono text-xl font-black tracking-[0.3em]" dir="rtl"><span className="text-primary">{lettersSpaced}</span><span className="mx-2 text-muted-foreground">—</span><span>{digitsSpaced}</span></p><p className="text-[10px] text-muted-foreground">{matched ? "✓ مطابقة" : !entry.complete ? "غير مكتملة" : "غير موجودة بالقاعدة"} • {new Date(entry.spokenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}{entry.confidence < 0.85 && ` • ثقة ${Math.round(entry.confidence * 100)}%`}</p>{entry.suspectPart && <p className="mt-1 rounded-lg bg-warning/10 px-2 py-1 text-[10px] text-warning">⚠ جزء مشكوك: <span className="font-mono">{entry.suspectPart}</span>{entry.correctionNote && ` — ${entry.correctionNote}`}</p>}{!entry.complete && <MissingPlateParts entry={entry} />}</div></div><AnimatePresence>{open && matched && entry.matchedPlate && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden border-t border-border pt-3 text-xs"><Row label="النوع" value={entry.matchedPlate.car_type} /><Row label="البنك" value={entry.matchedPlate.bank} /><Row label="الهيكل" value={entry.matchedPlate.chassis} /><Row label="التاريخ" value={entry.matchedPlate.plate_date} /></motion.div>}</AnimatePresence></motion.div>;
}, (prev, next) => {
  const a = prev.entry, b = next.entry;
  return a.id === b.id && a.digits === b.digits && a.letters === b.letters && a.complete === b.complete && !!a.matchedPlate === !!b.matchedPlate && a.spokenText === b.spokenText && a.correctionNote === b.correctionNote;
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

function rebuildDedupState(entries: PlateEntry[], growable: Map<string, { entryId: string; digits: string }>, finalized: Map<string, number>) {
  growable.clear();
  finalized.clear();
  for (const e of entries) {
    if (e.complete) finalized.set(e.normalized, e.spokenAt);
    else growable.set(e.letters, { entryId: e.id, digits: e.digits });
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