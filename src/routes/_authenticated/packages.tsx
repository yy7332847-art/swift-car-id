import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription } from "@/lib/subscription-check";
import { motion } from "motion/react";
import { CheckCircle2, Clock, Gift, Send, Sparkles, Package as PackageIcon, XCircle, AlertTriangle } from "lucide-react";
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
        .select("id, package_id, status, created_at, admin_note, packages(name)")
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);

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
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "approved") return <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-1 text-[10px] font-bold text-success"><CheckCircle2 className="h-2.5 w-2.5" />مقبول</span>;
  if (status === "rejected") return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-1 text-[10px] font-bold text-destructive"><XCircle className="h-2.5 w-2.5" />مرفوض</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-1 text-[10px] font-bold text-warning"><AlertTriangle className="h-2.5 w-2.5" />قيد المراجعة</span>;
}
