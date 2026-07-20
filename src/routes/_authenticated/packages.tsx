import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription } from "@/lib/subscription-check";
import { motion } from "motion/react";
import { CheckCircle2, Clock, Gift, Send, Sparkles, Package as PackageIcon, XCircle, AlertTriangle, History, Circle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/packages")({
  component: PackagesPage,
});

interface Pkg {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  price_egp: number;
  is_free: boolean;
  sort_order: number;
}

interface HistoryRow {
  id: string;
  package_name: string | null;
  status: string;
  reason: string | null;
  expires_at: string | null;
  ended_at: string | null;
  created_at: string;
}

function PackagesPage() {
  const qc = useQueryClient();
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });
  const { data: packages } = useQuery({
    queryKey: ["packages"],
    queryFn: async () => {
      const { data } = await supabase.from("packages").select("*").eq("is_active", true).order("sort_order");
      return (data ?? []) as Pkg[];
    },
  });
  const { data: myRequests } = useQuery({
    queryKey: ["my-requests"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("purchase_requests")
        .select("id, package_id, status, created_at, admin_note, processed_at, packages(name)")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });
  const { data: history } = useQuery({
    queryKey: ["sub-history"],
    queryFn: async (): Promise<HistoryRow[]> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("subscription_history" as never)
        .select("id, package_name, status, reason, expires_at, ended_at, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      return (data ?? []) as unknown as HistoryRow[];
    },
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function submit(pkgId: string) {
    setSending(true);
    const { error } = await supabase.rpc("create_purchase_request", {
      _package_id: pkgId, _note: note || null, _contact: contact || null,
    } as never);
    setSending(false);
    if (error) return toast.error(error.message);
    toast.success("تم إرسال طلبك إلى الإدارة");
    setOpenId(null); setNote(""); setContact("");
    qc.invalidateQueries({ queryKey: ["my-requests"] });
  }

  const pendingRequest = myRequests?.find((r) => r.status === "pending");

  return (
    <div className="px-5 pt-8 pb-6">
      <div className="mb-5 flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <PackageIcon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-black">الباقات</h1>
          <p className="text-xs text-muted-foreground">اختر الباقة المناسبة لك</p>
        </div>
      </div>

      {sub && (
        <div className="glass mb-5 rounded-2xl p-4">
          <p className="text-xs font-bold text-muted-foreground">اشتراكك الحالي</p>
          <div className="mt-2 flex items-center gap-2">
            {sub.active ? <CheckCircle2 className="h-5 w-5 text-success" /> : <XCircle className="h-5 w-5 text-destructive" />}
            <p className="font-black">{sub.packageName ?? (sub.active ? "مفعّل" : "غير مفعّل")}</p>
            {sub.daysLeft !== null && (
              <span className="mr-auto rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary">
                <Clock className="ml-0.5 inline h-2.5 w-2.5" /> {sub.daysLeft} يوم
              </span>
            )}
          </div>
        </div>
      )}

      {pendingRequest && (
        <div className="glass mb-5 rounded-2xl border border-warning/30 p-4">
          <p className="mb-3 inline-flex items-center gap-1.5 text-xs font-black text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> طلبك قيد المعالجة
          </p>
          <PurchaseTracker request={pendingRequest as unknown as { status: string; created_at: string; processed_at: string | null }} />
        </div>
      )}

      <div className="space-y-3">
        {packages?.map((p, i) => {
          const isCurrent = sub?.packageId === p.id && sub.active;
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className={`glass rounded-2xl p-4 ${isCurrent ? "ring-2 ring-primary" : ""}`}>
              <div className="flex items-start gap-3">
                <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${p.is_free ? "bg-success/20 text-success" : "bg-primary/20 text-primary"}`}>
                  {p.is_free ? <Gift className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black">{p.name}</p>
                    {isCurrent && <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-bold text-primary-foreground">الحالية</span>}
                    {p.is_free && <span className="rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold text-success">مجانية</span>}
                  </div>
                  {p.description && <p className="mt-1 text-[11px] text-muted-foreground">{p.description}</p>}
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="font-black text-lg">{p.is_free ? "مجاناً" : `${p.price_egp} ج.م`}</span>
                    <span className="text-muted-foreground">/ {p.duration_days} يوم</span>
                  </div>
                </div>
              </div>
              {!p.is_free && !isCurrent && (
                openId === p.id ? (
                  <div className="mt-3 space-y-2">
                    <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="رقم للتواصل (اختياري)"
                      className="w-full rounded-lg bg-muted px-3 py-2 text-xs" />
                    <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)"
                      className="w-full rounded-lg bg-muted px-3 py-2 text-xs" rows={2} />
                    <div className="flex gap-2">
                      <button disabled={sending} onClick={() => submit(p.id)} className="flex-1 rounded-lg bg-primary py-2 text-[11px] font-black text-primary-foreground disabled:opacity-50">
                        <Send className="ml-1 inline h-3 w-3" /> {sending ? "..." : "إرسال الطلب"}
                      </button>
                      <button onClick={() => setOpenId(null)} className="rounded-lg bg-muted px-3 py-2 text-[11px] font-bold">إلغاء</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setOpenId(p.id)} className="mt-3 w-full rounded-lg bg-primary py-2 text-[11px] font-black text-primary-foreground">
                    طلب الاشتراك
                  </button>
                )
              )}
            </motion.div>
          );
        })}
      </div>

      {myRequests && myRequests.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-sm font-black">طلباتي السابقة</h2>
          <div className="space-y-2">
            {myRequests.map((r) => {
              const pkg = (r as { packages?: { name?: string } | null }).packages;
              const st = r.status as string;
              return (
                <div key={r.id} className="glass flex items-center gap-3 rounded-xl p-3">
                  <StatusBadge status={st} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold">{pkg?.name ?? "-"}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString("ar-EG")}</p>
                    {r.admin_note && <p className="mt-1 text-[10px] text-muted-foreground">ملاحظة: {r.admin_note}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-6">
        <button onClick={() => setShowHistory((v) => !v)} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border py-3 text-xs font-black">
          <History className="h-3.5 w-3.5" /> سجل باقاتي السابقة {history ? `(${history.length})` : ""}
        </button>
        {showHistory && (
          <div className="mt-3 space-y-2">
            {(history ?? []).length === 0 && <p className="glass rounded-xl p-4 text-center text-[11px] text-muted-foreground">لا يوجد سجل بعد</p>}
            {(history ?? []).map((h) => (
              <div key={h.id} className="glass rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${h.status === "active" ? "bg-success/20 text-success" : h.status === "suspended" ? "bg-destructive/20 text-destructive" : "bg-muted text-muted-foreground"}`}>{h.status}</span>
                  <p className="text-xs font-bold">{h.package_name ?? "-"}</p>
                  <p className="mr-auto text-[10px] text-muted-foreground">{new Date(h.created_at).toLocaleDateString("ar-EG")}</p>
                </div>
                {h.expires_at && <p className="mt-1 text-[10px] text-muted-foreground">ينتهي: {new Date(h.expires_at).toLocaleDateString("ar-EG")}</p>}
                {h.reason && <p className="mt-1 text-[10px] text-muted-foreground">{h.reason}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-1 text-[10px] font-bold text-success"><CheckCircle2 className="h-2.5 w-2.5" />مقبول</span>;
  if (status === "rejected") return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-1 text-[10px] font-bold text-destructive"><XCircle className="h-2.5 w-2.5" />مرفوض</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-1 text-[10px] font-bold text-warning"><AlertTriangle className="h-2.5 w-2.5" />قيد المراجعة</span>;
}

// Visual step tracker for a pending purchase request.
function PurchaseTracker({ request }: { request: { status: string; created_at: string; processed_at: string | null } }) {
  const steps = [
    { label: "تم الإرسال", done: true, at: request.created_at },
    { label: "قيد المراجعة", done: request.status === "pending" || !!request.processed_at, active: request.status === "pending" },
    { label: request.status === "rejected" ? "مرفوض" : "مقبول ومفعّل", done: request.status !== "pending", at: request.processed_at },
  ];
  return (
    <div className="flex items-start gap-0">
      {steps.map((s, i) => (
        <div key={i} className="flex flex-1 flex-col items-center">
          <div className="flex w-full items-center">
            <div className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : s.done ? "bg-success" : "bg-muted"}`} />
            <div className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-black ${s.done ? "bg-success text-success-foreground" : s.active ? "bg-warning text-warning-foreground animate-pulse" : "bg-muted text-muted-foreground"}`}>
              {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
            </div>
            <div className={`h-0.5 flex-1 ${i === steps.length - 1 ? "opacity-0" : s.done ? "bg-success" : "bg-muted"}`} />
          </div>
          <p className="mt-1.5 text-center text-[9.5px] font-bold">{s.label}</p>
          {s.at && <p className="text-[8.5px] text-muted-foreground">{new Date(s.at).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })}</p>}
        </div>
      ))}
    </div>
  );
}
