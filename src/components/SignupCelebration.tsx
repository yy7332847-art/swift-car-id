import { useEffect, useRef, useState } from "react";
import confetti from "canvas-confetti";
import { motion, AnimatePresence } from "motion/react";
import { CheckCircle2, Gift, Sparkles } from "lucide-react";
import celebrationAssetJson from "@/assets/celebration.mp3.asset.json";

const CELEBRATION_URL = (celebrationAssetJson as { url: string }).url;
const TERMS = [
  "استخدام النظام مخصص لمحصلي البنوك ومندوبيهم المرخصين فقط.",
  "لا يجوز مشاركة الحساب أو بيانات اللوحات مع أطراف خارجية.",
  "الباقة المجانية صالحة لـ 3 أيام لتجربة النظام، ثم يلزم اختيار باقة مدفوعة.",
  "تحتفظ الإدارة بحق تعطيل الحساب في حال إساءة الاستخدام.",
  "بيانات الموقع تُستخدم فقط لتسجيل مسار الجلسة وتحسين المطابقة.",
];

export function SignupCelebration({ onDone, userName }: { onDone: () => void; userName: string }) {
  const [phase, setPhase] = useState<"celebrate" | "terms">("celebrate");
  const [accepted, setAccepted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Launch confetti burst for 12s
    const end = Date.now() + 12_000;
    const colors = ["#3b82f6", "#22c55e", "#facc15", "#ef4444", "#a855f7"];
    const iv = window.setInterval(() => {
      confetti({ particleCount: 5, angle: 60, spread: 65, origin: { x: 0, y: 0.7 }, colors });
      confetti({ particleCount: 5, angle: 120, spread: 65, origin: { x: 1, y: 0.7 }, colors });
      confetti({ particleCount: 3, angle: 90, spread: 80, origin: { x: 0.5, y: 0.2 }, colors, scalar: 1.2 });
      if (Date.now() >= end) window.clearInterval(iv);
    }, 220);
    // Big opening burst
    confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 }, colors });
    // Play audio (may need user gesture on some browsers, we try)
    const a = new Audio(CELEBRATION_URL);
    a.volume = 0.85;
    audioRef.current = a;
    a.play().catch(() => {/* autoplay blocked, ignore */});
    const swap = window.setTimeout(() => setPhase("terms"), 12_000);
    return () => {
      window.clearInterval(iv);
      window.clearTimeout(swap);
      a.pause();
      a.currentTime = 0;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-primary/95 via-primary to-success/90 backdrop-blur">
      <AnimatePresence mode="wait">
        {phase === "celebrate" ? (
          <motion.div key="cel" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} transition={{ type: "spring", damping: 14 }} className="mx-auto w-[min(92vw,420px)] rounded-3xl bg-background p-6 text-center shadow-2xl">
            <motion.div animate={{ rotate: [0, 10, -10, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="mx-auto mb-4 grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-success to-primary text-white shadow-xl">
              <Gift className="h-12 w-12" />
            </motion.div>
            <h1 className="text-2xl font-black">أهلاً وسهلاً {userName || "بك"}!</h1>
            <p className="mt-2 text-sm text-muted-foreground">تم إنشاء حسابك بنجاح 🎉</p>
            <div className="mt-4 rounded-2xl border border-success/40 bg-success/10 p-4">
              <p className="inline-flex items-center gap-2 text-sm font-black text-success"><Sparkles className="h-4 w-4" /> باقة مجانية 3 أيام</p>
              <p className="mt-1 text-[11px] text-muted-foreground">استمتع بجميع مميزات النظام مجاناً لمدة 3 أيام كاملة</p>
            </div>
            <p className="mt-4 text-[10px] text-muted-foreground">جاري تحضير شروط الاستخدام...</p>
          </motion.div>
        ) : (
          <motion.div key="terms" initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -20, opacity: 0 }} className="mx-auto flex max-h-[85vh] w-[min(92vw,440px)] flex-col rounded-3xl bg-background p-5 shadow-2xl">
            <h2 className="text-lg font-black">شروط الاستخدام</h2>
            <p className="mt-1 text-xs text-muted-foreground">اقرأ الشروط ثم وافق لبدء الاستخدام</p>
            <ol className="mt-4 flex-1 space-y-2 overflow-y-auto pl-1 pr-1">
              {TERMS.map((t, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-[12px] leading-6">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-black text-primary-foreground">{i + 1}</span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <label className="mt-4 flex items-center gap-2 rounded-xl border p-3 text-xs font-bold">
              <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="h-4 w-4 accent-primary" />
              أوافق على شروط الاستخدام
            </label>
            <button disabled={!accepted} onClick={onDone} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground disabled:opacity-50">
              <CheckCircle2 className="h-4 w-4" /> ابدأ الاستخدام
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
