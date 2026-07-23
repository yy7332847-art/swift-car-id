import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { motion } from "motion/react";
import { Upload, Mic, ListChecks, Clock, Database, TrendingUp, ShieldAlert, Table } from "lucide-react";

export const Route = createFileRoute("/_authenticated/home")({
  head: () => ({
    meta: [
      { title: "الرئيسية — مجدي للتشييك" },
      { name: "description", content: "لوحة المستخدم لمتابعة اللوحات والجلسات وبدء التسجيل الصوتي الفوري." },
      { property: "og:title", content: "الرئيسية — مجدي للتشييك" },
      { property: "og:description", content: "ابدأ التسجيل وارفع ملفات Excel وتابع إحصائيات المطابقة من حسابك." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: isAdmin });
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("full_name, email").eq("id", u.user.id).maybeSingle();
      return data;
    },
  });
  const { data: stats } = useQuery({
    queryKey: ["home-stats"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { plates: 0, sessions: 0, matches: 0 };
      const [p, s, m] = await Promise.all([
        supabase.from("plates").select("id", { count: "exact", head: true }).eq("user_id", u.user.id),
        supabase.from("recognition_sessions").select("id", { count: "exact", head: true }).eq("user_id", u.user.id),
        supabase.from("detected_plates").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).eq("is_matched", true),
      ]);
      return { plates: p.count ?? 0, sessions: s.count ?? 0, matches: m.count ?? 0 };
    },
  });

  const notActive = sub && !sub.active && !admin;

  return (
    <div className="px-5 pt-8">
      <motion.header initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <p className="text-xs text-muted-foreground">مرحباً</p>
        <h1 className="mt-1 text-2xl font-black">{profile?.full_name || profile?.email || "المستخدم"}</h1>
      </motion.header>

      {notActive && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="mb-5 rounded-2xl border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <div className="min-w-0">
              <p className="font-bold text-warning">حسابك غير مفعّل</p>
              <p className="mt-1 text-xs text-muted-foreground">يرجى التواصل مع الإدارة لتفعيل اشتراكك.</p>
            </div>
          </div>
        </motion.div>
      )}

      {sub?.active && sub.daysLeft !== null && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-5 rounded-2xl bg-primary/10 border border-primary/20 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">اشتراكك مفعّل</p>
              <p className="font-black text-primary">متبقٍ {sub.daysLeft} يوم</p>
            </div>
          </div>
        </motion.div>
      )}

      <div className="mb-6 grid grid-cols-3 gap-2">
        <StatCard icon={Database} label="لوحات" value={stats?.plates ?? 0} />
        <StatCard icon={ListChecks} label="جلسات" value={stats?.sessions ?? 0} />
        <StatCard icon={TrendingUp} label="مطابقات" value={stats?.matches ?? 0} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ActionCard to="/record" icon={Mic} title="ابدأ التسجيل" desc="تعرّف صوتي فوري" primary />
        <ActionCard to="/upload" icon={Upload} title="رفع ملف Excel" desc="حدّث قاعدة اللوحات" />
        <ActionCard to="/plates" icon={Table} title="جدول اللوحات" desc="بحث + سجل الفحص لكل لوحة" />
        <ActionCard to="/sessions" icon={ListChecks} title="الجلسات السابقة" desc="التقارير والسجل" />
        {admin && <ActionCard to="/admin" icon={ShieldAlert} title="لوحة الإدارة" desc="المستخدمون والاشتراكات" />}
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number }) {
  return (
    <div className="glass rounded-2xl p-3 text-center">
      <Icon className="mx-auto mb-1 h-4 w-4 text-primary" />
      <p className="text-lg font-black">{value.toLocaleString("ar-EG")}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function ActionCard({ to, icon: Icon, title, desc, primary }: { to: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; title: string; desc: string; primary?: boolean }) {
  return (
    <Link to={to} className={`glass block rounded-2xl p-4 transition-all active:scale-95 ${primary ? "border border-primary/40 glow-primary" : ""}`}>
      <Icon className={`mb-2 h-6 w-6 ${primary ? "text-primary" : "text-foreground"}`} strokeWidth={2.5} />
      <p className="font-bold">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{desc}</p>
    </Link>
  );
}
