import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, CheckCircle2, AlertTriangle, Loader2, Info, Car, Settings2, X } from "lucide-react";
import { startRecorder, type RecorderHandle } from "@/lib/audio-recorder";
import { extractPlates, plateAppearsInText, type DetectedPlate } from "@/lib/plate-utils";

export const Route = createFileRoute("/_authenticated/record")({
  component: RecordPage,
});

interface PlateEntry extends DetectedPlate {
  id: string;
  spokenAt: number;
  matchedPlate?: {
    plate_raw: string;
    bank: string | null;
    car_type: string | null;
    chassis: string | null;
    plate_date: string | null;
  };
}

function RecordPage() {
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: isAdmin });

  const { data: platesIndex, isLoading: platesLoading } = useQuery({
    queryKey: ["plates-index"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { map: new Map(), count: 0 };
      const map = new Map<string, { id: string; plate_raw: string; bank: string | null; car_type: string | null; chassis: string | null; plate_date: string | null }>();
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
          map.set(p.plate_normalized, { id: p.id, plate_raw: p.plate_raw, bank: p.bank, car_type: p.car_type, chassis: p.chassis, plate_date: p.plate_date });
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
      return { map, count: map.size };
    },
  });

  const [calibrating, setCalibrating] = useState(false);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [entries, setEntries] = useState<PlateEntry[]>([]);
  const [transcript, setTranscript] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<RecorderHandle | null>(null);
  const pendingRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!startedAt) return;
    const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(iv);
  }, [startedAt]);

  const processChunk = useCallback(async (wav: Blob) => {
    pendingRef.current++;
    setProcessing(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) return;
      const form = new FormData();
      form.append("audio", wav, "chunk.wav");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        console.error("STT", res.status, await res.text().catch(() => ""));
        return;
      }
      const json = await res.json();
      const text: string = (json.text || "").trim();
      if (!text || text.length < 2) return;
      setTranscript((prev) => (prev + " " + text).trim().slice(-2000));

      const plates = extractPlates(text);
      if (plates.length === 0) return;

      const sid = sessionIdRef.current;
      if (!sid) return;

      const now = Date.now();
      const inserts: Array<{
        session_id: string;
        user_id: string;
        spoken_text: string;
        plate_raw: string;
        plate_normalized: string;
        is_matched: boolean;
        is_incomplete: boolean;
        matched_plate_id: string | null;
        confidence: number;
        suspect_part: string | null;
        correction_note: string | null;
      }> = [];

      const newEntries: PlateEntry[] = [];

      for (const p of plates) {
        // Hallucination guard: every plate character must have spoken evidence in this chunk.
        if (!plateAppearsInText(p.letters, p.digits, text)) continue;
        // Dedupe across chunks for this session.
        if (seenRef.current.has(p.normalized)) continue;
        seenRef.current.add(p.normalized);

        const match = platesIndex?.map.get(p.normalized);
        // Only mark matched when: value exists in DB AND plate was clearly heard.
        const isMatched = !!match && p.complete && p.confidence >= 0.85;

        newEntries.push({
          ...p,
          id: crypto.randomUUID(),
          spokenAt: now,
          matchedPlate: isMatched ? { plate_raw: match!.plate_raw, bank: match!.bank, car_type: match!.car_type, chassis: match!.chassis, plate_date: match!.plate_date } : undefined,
        });

        inserts.push({
          session_id: sid,
          user_id: sess.session!.user.id,
          spoken_text: text,
          plate_raw: p.raw,
          plate_normalized: p.normalized,
          is_matched: isMatched,
          is_incomplete: !p.complete,
          matched_plate_id: isMatched ? match!.id : null,
          confidence: p.confidence,
          suspect_part: p.suspectPart ?? null,
          correction_note: p.correctionNote ?? null,
        });
      }

      if (newEntries.length > 0) {
        setEntries((prev) => [...newEntries.reverse(), ...prev].slice(0, 500));
      }

      if (inserts.length > 0) {
        const { error } = await supabase.from("detected_plates").insert(inserts);
        if (error) console.error("insert detected_plates", error);
        for (const n of newEntries) {
          if (n.matchedPlate) {
            if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
            toast.success(`تطابق: ${n.raw}`, { description: n.matchedPlate.car_type || undefined });
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      pendingRef.current--;
      if (pendingRef.current === 0) setProcessing(false);
    }
  }, [platesIndex]);

  async function beginSession() {
    if (!platesIndex || platesIndex.count === 0) {
      toast.warning("قم برفع ملف Excel أولاً");
      return;
    }
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: session, error } = await supabase
        .from("recognition_sessions")
        .insert({ user_id: u.user.id })
        .select("id")
        .single();
      if (error) throw error;
      sessionIdRef.current = session.id;
      seenRef.current = new Set();
      setSessionId(session.id);
      setEntries([]);
      setTranscript("");
      setStartedAt(Date.now());
      setElapsed(0);

      recorderRef.current = await startRecorder({
        chunkSeconds: 3.5,
        targetSampleRate: 16000,
        onLevel: setLevel,
        onChunk: (wav) => void processChunk(wav),
      });
      setRecording(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "تعذر بدء التسجيل");
    }
  }

  async function stopRecording() {
    setRecording(false);
    await recorderRef.current?.stop();
    recorderRef.current = null;
    const sid = sessionIdRef.current;
    if (sid) {
      const matched = entries.filter((e) => e.matchedPlate).length;
      const incomplete = entries.filter((e) => !e.complete).length;
      await supabase.from("recognition_sessions").update({
        ended_at: new Date().toISOString(),
        total_detected: entries.length,
        total_matched: matched,
        total_incomplete: incomplete,
      }).eq("id", sid);
      toast.success(`تم حفظ الجلسة — ${entries.length} لوحة، ${matched} مطابقة`);
    }
    setStartedAt(null);
    setLevel(0);
  }

  useEffect(() => () => { void recorderRef.current?.stop(); }, []);

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

      {notActive && (
        <div className="mb-4 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          الحساب غير مفعّل. لا يمكن استخدام التسجيل.
        </div>
      )}

      <div className="my-4 flex flex-col items-center">
        <button
          onClick={recording ? stopRecording : beginSession}
          disabled={!!notActive || platesLoading}
          className={`relative grid h-40 w-40 place-items-center rounded-full transition-all disabled:opacity-40 ${
            recording ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground glow-primary"
          }`}
        >
          {recording && (
            <>
              <motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.4 + level * 4], opacity: [0.6, 0] }} transition={{ duration: 1.5, repeat: Infinity }} />
              <motion.span className="absolute inset-0 rounded-full border-2 border-destructive" animate={{ scale: [1, 1.8 + level * 4], opacity: [0.4, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.4 }} />
            </>
          )}
          {recording ? <Square className="h-16 w-16" strokeWidth={2.5} fill="currentColor" /> : <Mic className="h-16 w-16" strokeWidth={2.5} />}
        </button>
        <p className="mt-4 text-lg font-black">{recording ? formatTime(elapsed) : "اضغط للبدء"}</p>
        {processing && <p className="mt-1 flex items-center gap-1 text-xs text-primary"><Loader2 className="h-3 w-3 animate-spin" /> جاري التعرّف...</p>}
        {!recording && (
          <button onClick={() => setCalibrating(true)} disabled={!!notActive} className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted/60 px-3 py-1.5 text-xs font-bold disabled:opacity-40">
            <Settings2 className="h-3 w-3" /> معايرة الميكروفون
          </button>
        )}
      </div>

      {transcript && recording && (
        <div className="mb-3 rounded-2xl bg-muted/50 p-3 text-xs text-muted-foreground">
          <span className="font-bold">آخر ما سُمع: </span>
          {transcript.slice(-150)}
        </div>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="glass rounded-xl p-2"><p className="text-lg font-black">{entries.length}</p><p className="text-[10px] text-muted-foreground">مكتشفة</p></div>
        <div className="glass rounded-xl p-2 border border-success/40"><p className="text-lg font-black text-success">{entries.filter((e) => e.matchedPlate).length}</p><p className="text-[10px] text-muted-foreground">مطابقة</p></div>
        <div className="glass rounded-xl p-2 border border-warning/40"><p className="text-lg font-black text-warning">{entries.filter((e) => !e.complete).length}</p><p className="text-[10px] text-muted-foreground">غير مكتملة</p></div>
      </div>

      {!recording && sessionId && entries.length > 0 && (
        <Link to="/sessions/$id" params={{ id: sessionId }} className="mb-3 block rounded-2xl bg-primary p-3 text-center text-sm font-bold text-primary-foreground">
          عرض تقرير الجلسة
        </Link>
      )}

      <div className="flex-1 space-y-2 pb-4">
        <AnimatePresence initial={false}>
          {entries.map((e) => <PlateCard key={e.id} entry={e} />)}
        </AnimatePresence>
        {entries.length === 0 && !recording && (
          <div className="rounded-2xl bg-muted/30 p-6 text-center text-sm text-muted-foreground">
            <Info className="mx-auto mb-2 h-6 w-6" />
            اضغط زر الميكروفون وابدأ بنطق أرقام اللوحات
          </div>
        )}
      </div>

      <AnimatePresence>
        {calibrating && <CalibrationSheet onClose={() => setCalibrating(false)} />}
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
        const h = await startRecorder({
          chunkSeconds: 60,
          targetSampleRate: 16000,
          onLevel: (l) => {
            if (cancelled) return;
            setLevel(l);
            setMaxLevel((m) => Math.max(m, l));
          },
          onChunk: () => { /* discarded during calibration */ },
        });
        handleRef.current = h;
        setRunning(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "تعذر فتح الميكروفون");
      }
    })();
    return () => {
      cancelled = true;
      void handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  // Rating
  const rating =
    maxLevel < 0.02 ? { label: "منخفض جداً — تحدّث بصوت أعلى أو قرّب الميكروفون", color: "text-destructive", bar: "bg-destructive" } :
    maxLevel < 0.06 ? { label: "مقبول — يفضّل التحدّث بصوت أوضح", color: "text-warning", bar: "bg-warning" } :
    maxLevel > 0.5 ? { label: "مرتفع جداً — أبعد الميكروفون قليلاً", color: "text-warning", bar: "bg-warning" } :
    { label: "ممتاز — جاهز للتسجيل", color: "text-success", bar: "bg-success" };

  const barPct = Math.min(100, Math.round(level * 350));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }} transition={{ type: "spring", stiffness: 300, damping: 30 }} className="w-full max-w-[440px] rounded-t-3xl bg-background p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-black">معايرة الميكروفون</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">تحدّث بصوتك الطبيعي لعدة ثوانٍ. راقب المؤشّر ليتأكد من وضوح الصوت.</p>

        {error ? (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-2">
              <Mic className={`h-5 w-5 ${running ? "text-primary" : "text-muted-foreground"}`} />
              <span className="text-xs font-bold">مستوى الصوت الحالي</span>
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{barPct}%</span>
            </div>
            <div className="mb-4 h-4 overflow-hidden rounded-full bg-muted">
              <motion.div className={`h-full ${rating.bar}`} animate={{ width: `${barPct}%` }} transition={{ duration: 0.1 }} />
            </div>
            <div className="mb-1 text-xs text-muted-foreground">أعلى قيمة مسجّلة: <span className="font-bold text-foreground tabular-nums">{Math.round(maxLevel * 350)}%</span></div>
            <div className={`rounded-2xl border p-3 text-sm font-bold ${rating.color} ${running ? "border-current/30" : "border-transparent"}`}>{running ? rating.label : "جاري تشغيل الميكروفون..."}</div>
          </>
        )}

        <button onClick={onClose} className="mt-5 w-full rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground">
          تم
        </button>
      </motion.div>
    </motion.div>
  );
}

function PlateCard({ entry }: { entry: PlateEntry }) {
  const [open, setOpen] = useState(false);
  const matched = !!entry.matchedPlate;
  const lettersSpaced = entry.letters.split("").join(" ");
  const digitsSpaced = entry.digits.split("").join(" ");
  return (
    <motion.div
      initial={{ opacity: 0, x: -20, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 20 }}
      layout
      onClick={() => matched && setOpen((o) => !o)}
      className={`glass overflow-hidden rounded-2xl p-3 ${
        matched ? "border border-success/50 glow-success cursor-pointer" : !entry.complete ? "border border-warning/40" : "border border-border"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
          matched ? "bg-success/20 text-success" : !entry.complete ? "bg-warning/20 text-warning" : "bg-muted"
        }`}>
          {matched ? <CheckCircle2 className="h-5 w-5" /> : !entry.complete ? <AlertTriangle className="h-5 w-5" /> : <Car className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xl font-black tracking-[0.3em]" dir="rtl">
            <span className="text-primary">{lettersSpaced}</span>
            <span className="mx-2 text-muted-foreground">—</span>
            <span>{digitsSpaced}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            {matched ? "✓ مطابقة" : !entry.complete ? "غير مكتملة" : "غير موجودة بالقاعدة"}
            {" • "}
            {new Date(entry.spokenAt).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            {entry.confidence < 0.85 && ` • ثقة ${Math.round(entry.confidence * 100)}%`}
          </p>
          {entry.suspectPart && (
            <p className="mt-1 rounded-lg bg-warning/10 px-2 py-1 text-[10px] text-warning">
              ⚠ جزء مشكوك: <span className="font-mono">{entry.suspectPart}</span>
              {entry.correctionNote && ` — ${entry.correctionNote}`}
            </p>
          )}
        </div>
      </div>
      <AnimatePresence>
        {open && matched && entry.matchedPlate && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden border-t border-border pt-3 text-xs">
            <Row label="النوع" value={entry.matchedPlate.car_type} />
            <Row label="البنك" value={entry.matchedPlate.bank} />
            <Row label="الهيكل" value={entry.matchedPlate.chassis} />
            <Row label="التاريخ" value={entry.matchedPlate.plate_date} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-left font-mono">{value}</span>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}
