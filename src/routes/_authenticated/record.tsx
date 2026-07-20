import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, CheckCircle2, AlertTriangle, Loader2, Info, Car, Settings2, X, Radio, Sparkles } from "lucide-react";
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
  // Transient "just captured" state — drives the live status pill.
  const [lastCapture, setLastCapture] = useState<{ raw: string; complete: boolean; matched: boolean; at: number } | null>(null);


  const recorderRef = useRef<RecorderHandle | null>(null);
  const pendingRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  // Letters-key → { entryId, dbId, digits } for plates still eligible to grow (incomplete).
  const growableRef = useRef<Map<string, { entryId: string; dbId: string; digits: string }>>(new Map());
  // Letters that already finalized as complete — don't re-insert on later chunks.
  const finalizedRef = useRef<Set<string>>(new Set());

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

      for (const p of plates) {
        if (!plateAppearsInText(p.letters, p.digits, text)) continue;

        const key = p.letters;
        const match = platesIndex?.map.get(p.normalized);
        const isMatched = !!match && p.complete && p.confidence >= 0.85;
        const now = Date.now();

        const existing = growableRef.current.get(key);
        if (existing) {
          // Upgrade only if new digits are strictly longer or we newly satisfy completeness.
          const grew = p.digits.length > existing.digits.length;
          if (!grew) continue;
          const patch = {
            plate_raw: p.raw,
            plate_normalized: p.normalized,
            is_matched: isMatched,
            is_incomplete: !p.complete,
            matched_plate_id: isMatched ? match!.id : null,
            confidence: p.confidence,
            suspect_part: p.suspectPart ?? null,
            correction_note: p.correctionNote ?? null,
          };
          const { error } = await supabase.from("detected_plates").update(patch).eq("id", existing.dbId);
          if (error) { console.error("update detected_plates", error); continue; }
          setEntries((prev) => prev.map((e) => e.id === existing.entryId ? {
            ...e, raw: p.raw, normalized: p.normalized, letters: p.letters, digits: p.digits,
            complete: p.complete, confidence: p.confidence, suspectPart: p.suspectPart, correctionNote: p.correctionNote,
            matchedPlate: isMatched ? { plate_raw: match!.plate_raw, bank: match!.bank, car_type: match!.car_type, chassis: match!.chassis, plate_date: match!.plate_date } : undefined,
          } : e));
          setLastCapture({ raw: p.raw, complete: p.complete, matched: isMatched, at: Date.now() });
          if (p.complete) {
            growableRef.current.delete(key);
            finalizedRef.current.add(key);
            if (isMatched && navigator.vibrate) navigator.vibrate([50, 30, 100]);
            if (isMatched) toast.success(`تطابق: ${p.raw}`, { description: match!.car_type || undefined });
          } else {
            growableRef.current.set(key, { ...existing, digits: p.digits });
          }
          continue;

        }

        if (finalizedRef.current.has(key)) continue;

        const insertRow = {
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
        };
        const { data: inserted, error } = await supabase.from("detected_plates").insert(insertRow).select("id").single();
        if (error || !inserted) { console.error("insert detected_plates", error); continue; }

        const entryId = crypto.randomUUID();
        const entry: PlateEntry = {
          ...p,
          id: entryId,
          spokenAt: now,
          matchedPlate: isMatched ? { plate_raw: match!.plate_raw, bank: match!.bank, car_type: match!.car_type, chassis: match!.chassis, plate_date: match!.plate_date } : undefined,
        };
        setEntries((prev) => [entry, ...prev].slice(0, 500));
        setLastCapture({ raw: p.raw, complete: p.complete, matched: isMatched, at: now });
        if (p.complete) {
          finalizedRef.current.add(key);
          if (isMatched) {
            if (navigator.vibrate) navigator.vibrate([50, 30, 100]);
            toast.success(`تطابق: ${p.raw}`, { description: match!.car_type || undefined });
          }
        } else {
          growableRef.current.set(key, { entryId, dbId: inserted.id, digits: p.digits });
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
      growableRef.current = new Map();
      finalizedRef.current = new Set();
      setSessionId(session.id);
      setEntries([]);
      setTranscript("");
      setStartedAt(Date.now());
      setElapsed(0);

      recorderRef.current = await startRecorder({
        chunkSeconds: 1.4,
        overlapSeconds: 0.6,
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
    // Wait briefly for any in-flight chunk to complete before summarizing.
    const waitStart = Date.now();
    while (pendingRef.current > 0 && Date.now() - waitStart < 8000) {
      await new Promise((r) => setTimeout(r, 200));
    }
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
      if (incomplete > 0) {
        toast.warning(`${incomplete} لوحة غير مكتملة — راجعها بالأسفل`, { duration: 6000 });
      }
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

      {recording && (
        <LiveStatusBar
          processing={processing}
          transcript={transcript}
          lastCapture={lastCapture}
          level={level}
        />
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

function LiveStatusBar({
  processing, transcript, lastCapture, level,
}: {
  processing: boolean;
  transcript: string;
  lastCapture: { raw: string; complete: boolean; matched: boolean; at: number } | null;
  level: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(iv);
  }, []);
  const recent = lastCapture && now - lastCapture.at < 2500 ? lastCapture : null;
  const state: "captured" | "transcribing" | "listening" =
    recent ? "captured" : processing ? "transcribing" : "listening";

  const tone =
    state === "captured"
      ? recent!.matched
        ? { pill: "bg-success/20 text-success border-success/40", bar: "bg-success" }
        : recent!.complete
          ? { pill: "bg-primary/20 text-primary border-primary/40", bar: "bg-primary" }
          : { pill: "bg-warning/20 text-warning border-warning/40", bar: "bg-warning" }
      : state === "transcribing"
        ? { pill: "bg-primary/15 text-primary border-primary/30", bar: "bg-primary" }
        : { pill: "bg-muted text-muted-foreground border-border", bar: "bg-primary/60" };

  const label =
    state === "captured"
      ? recent!.matched
        ? `تطابق: ${recent!.raw}`
        : recent!.complete
          ? `التقطت: ${recent!.raw}`
          : `ناقصة: ${recent!.raw}`
      : state === "transcribing"
        ? "جاري التعرّف على الصوت..."
        : "الاستماع — تحدّث بأرقام اللوحة";

  const Icon = state === "captured" ? (recent!.matched ? CheckCircle2 : recent!.complete ? Sparkles : AlertTriangle) : state === "transcribing" ? Loader2 : Radio;
  const barPct = state === "transcribing" ? undefined : Math.min(100, Math.round(level * 350));

  return (
    <div className={`mb-3 overflow-hidden rounded-2xl border p-2.5 ${tone.pill.replace("text-", "border-").split(" ")[2] ?? ""}`}>
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${tone.pill}`}>
          <Icon className={`h-3.5 w-3.5 ${state === "transcribing" ? "animate-spin" : ""}`} />
          {label}
        </span>
        {transcript && (
          <span className="ml-auto truncate text-[10.5px] text-muted-foreground" dir="rtl">
            {transcript.slice(-80)}
          </span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted/60">
        {state === "transcribing" ? (
          <motion.div className={`h-full ${tone.bar}`} initial={{ x: "-40%", width: "40%" }} animate={{ x: "100%" }} transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }} />
        ) : (
          <motion.div className={`h-full ${tone.bar}`} animate={{ width: `${barPct}%` }} transition={{ duration: 0.15 }} />
        )}
      </div>
    </div>
  );
}


function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}
