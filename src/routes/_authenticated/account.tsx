import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { LogOut, User as UserIcon, Mail, Clock, CheckCircle2, XCircle, ShieldCheck, FileText, Download, ListChecks, AlertTriangle, ChevronLeft, Package as PackageIcon, Ban, Settings as SettingsIcon, Flame } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { exportSessionExcel, exportSessionPDF, formatDuration, sessionDurationSec, type SessionRow } from "@/lib/report-export";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountPage,
});

function AccountPage() {
  const navigate = useNavigate();
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: isAdmin });
  const { data: profile } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("full_name, email, created_at").eq("id", u.user.id).maybeSingle();
      return data;
    },
  });
  const { data: sessions } = useQuery({
    queryKey: ["my-sessions"],
    queryFn: async (): Promise<SessionRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("recognition_sessions")
        .select("id, started_at, ended_at, total_detected, total_matched, total_incomplete")
        .eq("user_id", u.user.id)
        .order("started_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
    navigate({ to: "/auth" });
  }

  return (
    <div className="px-5 pt-8">
      <h1 className="mb-5 text-2xl font-black">حسابي</h1>

      <div className="glass mb-4 rounded-3xl p-5 text-center">
        <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-primary text-primary-foreground">
          <UserIcon className="h-8 w-8" />
        </div>
        <p className="text-lg font-black">{profile?.full_name || "المستخدم"}</p>
        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">{profile?.email}</p>
        {admin && (
          <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-primary/20 px-3 py-1 text-[10px] font-bold text-primary">
            <ShieldCheck className="h-3 w-3" /> مدير
          </span>
        )}
      </div>

      <div className="glass mb-4 rounded-2xl p-4">
        <p className="mb-3 text-xs font-bold text-muted-foreground">الاشتراك</p>
        <div className="flex items-center gap-3">
          {sub?.status === "suspended" ? (
            <>
              <Ban className="h-6 w-6 text-destructive" />
              <div><p className="font-bold text-destructive">حساب معطّل</p>{sub.suspendReason && <p className="text-xs text-muted-foreground">{sub.suspendReason}</p>}</div>
            </>
          ) : sub?.active ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="font-bold text-success">{sub.packageName ?? "مفعّل"}</p>
                {sub.daysLeft !== null && <p className="text-xs text-muted-foreground">متبقٍ {sub.daysLeft} يوم</p>}
              </div>
            </>
          ) : (
            <>
              <XCircle className="h-6 w-6 text-destructive" />
              <div>
                <p className="font-bold text-destructive">{sub?.status === "expired" ? "الباقة منتهية" : "غير مفعّل"}</p>
                <p className="text-xs text-muted-foreground">اطلب باقة للبدء</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link to="/packages" className="glass flex items-center justify-center gap-2 rounded-2xl p-3 text-xs font-black">
          <PackageIcon className="h-4 w-4 text-primary" /> الباقات
        </Link>
        <Link to="/sessions" className="glass flex items-center justify-center gap-2 rounded-2xl p-3 text-xs font-black">
          <ListChecks className="h-4 w-4 text-primary" /> جلساتي
        </Link>
        <Link to="/settings" className="glass col-span-2 flex items-center justify-center gap-2 rounded-2xl p-3 text-xs font-black">
          <SettingsIcon className="h-4 w-4 text-primary" /> الإعدادات (البطارية والتنبيهات)
        </Link>
        {admin && (
          <Link to="/admin" className="glass col-span-2 flex items-center justify-center gap-2 rounded-2xl p-3 text-xs font-black">
            <ShieldCheck className="h-4 w-4 text-primary" /> لوحة الإدارة
          </Link>
        )}
      </div>


      <div className="glass mb-4 rounded-2xl p-4 text-sm">
        <InfoRow icon={Mail} label="البريد" value={profile?.email ?? ""} />
        <InfoRow icon={Clock} label="تاريخ الإنشاء" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString("ar-EG") : ""} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-black"><ListChecks className="h-4 w-4" /> آخر جلساتي</h2>
        <Link to="/sessions" className="text-[11px] font-bold text-primary">عرض الكل</Link>
      </div>
      <div className="mb-6 space-y-2">
        {sessions && sessions.length > 0 ? (
          sessions.slice(0, 8).map((s) => <SessionRowCard key={s.id} session={s} />)
        ) : (
          <p className="rounded-2xl bg-muted/50 p-4 text-center text-xs text-muted-foreground">لا توجد جلسات بعد</p>
        )}
      </div>

      <button onClick={signOut} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive py-3 text-sm font-black text-destructive-foreground">
        <LogOut className="h-4 w-4" /> تسجيل الخروج
      </button>
    </div>
  );
}

function SessionRowCard({ session }: { session: SessionRow }) {
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const dur = sessionDurationSec(session);
  const errors = session.total_detected - session.total_matched;

  async function download(kind: "pdf" | "xlsx") {
    try {
      setBusy(kind);
      if (kind === "pdf") await exportSessionPDF(session);
      else await exportSessionExcel(session);
      toast.success(`تم تنزيل ${kind.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التنزيل");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass rounded-2xl p-3">
      <div className="flex items-start gap-3">
        <Link to="/sessions/$id" params={{ id: session.id }} className="flex min-w-0 flex-1 items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold">{new Date(session.started_at).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" })}</p>
            <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
              <span className="text-muted-foreground">مدة: <span className="font-mono font-bold text-foreground">{formatDuration(dur)}</span></span>
              <span className="text-success"><CheckCircle2 className="ml-0.5 inline h-2.5 w-2.5" />{session.total_matched} مطابقة</span>
              <span className="text-warning"><AlertTriangle className="ml-0.5 inline h-2.5 w-2.5" />{session.total_incomplete} ناقصة</span>
              <span className="text-destructive">{errors - session.total_incomplete >= 0 ? errors - session.total_incomplete : 0} غير موجودة</span>
            </div>
          </div>
          <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </div>
      <div className="mt-2 flex gap-2">
        <button disabled={busy !== null} onClick={() => download("pdf")} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-muted px-2 py-1.5 text-[10px] font-bold disabled:opacity-50">
          <FileText className="h-3 w-3 text-destructive" /> {busy === "pdf" ? "..." : "PDF"}
        </button>
        <button disabled={busy !== null} onClick={() => download("xlsx")} className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-muted px-2 py-1.5 text-[10px] font-bold disabled:opacity-50">
          <Download className="h-3 w-3 text-success" /> {busy === "xlsx" ? "..." : "Excel"}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/50 py-2 last:border-0">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex-1 text-left font-mono text-xs">{value}</span>
    </div>
  );
}
