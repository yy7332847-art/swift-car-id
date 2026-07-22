import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion } from "motion/react";
import { Loader2, Car, ScanLine } from "lucide-react";
import { SignupCelebration } from "@/components/SignupCelebration";
import { InstallPWAButton } from "@/components/InstallPWAButton";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/home" });
    });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: `${window.location.origin}/home`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        setCelebrate(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("مرحباً بعودتك");
        navigate({ to: "/home" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "خطأ غير متوقع";
      toast.error(msg.includes("Invalid login") ? "بيانات الدخول غير صحيحة" : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col justify-center px-6 py-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8 flex flex-col items-center text-center">
        <div className="relative mb-4">
          <div className="grid h-20 w-20 place-items-center rounded-3xl bg-primary text-primary-foreground glow-primary">
            <ScanLine className="h-10 w-10" strokeWidth={2.5} />
          </div>
          <Car className="absolute -bottom-2 -left-2 h-8 w-8 text-success" />
        </div>
        <h1 className="text-3xl font-black">تشييك اللوحات</h1>
        <p className="mt-2 text-sm text-muted-foreground">تعرّف صوتي فوري على لوحات السيارات</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-5 flex justify-center"
      >
        <InstallPWAButton />
      </motion.div>


      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass rounded-3xl p-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
          {(["login", "signup"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-xl py-2.5 text-sm font-bold transition-all ${mode === m ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"}`}>
              {m === "login" ? "تسجيل الدخول" : "إنشاء حساب"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <div>
              <label className="mb-1.5 block text-xs font-bold text-muted-foreground">الاسم الكامل</label>
              <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-xl bg-input px-4 py-3 text-sm outline-none ring-primary/40 focus:ring-2" placeholder="الاسم" required />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-muted-foreground">البريد الإلكتروني</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-xl bg-input px-4 py-3 text-sm outline-none ring-primary/40 focus:ring-2" dir="ltr" placeholder="you@example.com" required autoComplete="email" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-muted-foreground">كلمة المرور</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-xl bg-input px-4 py-3 text-sm outline-none ring-primary/40 focus:ring-2" dir="ltr" placeholder="••••••••" required minLength={6} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          </div>
          <button type="submit" disabled={loading} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-black text-primary-foreground shadow-lg glow-primary disabled:opacity-60">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" ? "دخول" : "إنشاء حساب"}
          </button>
        </form>
        {mode === "signup" && (
          <p className="mt-4 text-center text-[11px] text-muted-foreground">
            الحساب يحتاج تفعيل من الإدارة قبل استخدام النظام
          </p>
        )}
      </motion.div>
      {celebrate && <SignupCelebration userName={fullName} onDone={() => { setCelebrate(false); navigate({ to: "/home" }); }} />}
    </div>
  );
}
