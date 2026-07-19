import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion } from "motion/react";
import { ShieldCheck, User as UserIcon, CheckCircle2, XCircle, Zap, Ban, RefreshCw } from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

interface UserRow {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  expires_at: string | null;
  role: string;
}

function AdminPage() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: iAmAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-admin-check"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
      return !!data;
    },
  });

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    enabled: !!iAmAdmin,
    queryFn: async () => {
      // Admins have RLS to read all profiles/roles/subs
      const [{ data: profiles }, { data: subs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }),
        supabase.from("subscriptions").select("user_id, is_active, expires_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const subMap = new Map((subs ?? []).map((s) => [s.user_id, s]));
      const roleMap = new Map<string, string>();
      for (const r of roles ?? []) roleMap.set(r.user_id, r.role);
      const list: UserRow[] = (profiles ?? []).map((p) => {
        const s = subMap.get(p.id);
        const active = !!s?.is_active && (!s.expires_at || new Date(s.expires_at) > new Date());
        return {
          id: p.id,
          email: p.email,
          full_name: p.full_name,
          is_active: active,
          expires_at: s?.expires_at ?? null,
          role: roleMap.get(p.id) ?? "user",
        };
      });
      return list;
    },
  });

  async function activate(userId: string, days: number) {
    setBusy(userId);
    const { error } = await supabase.rpc("activate_subscription", { _user_id: userId, _days: days });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`تم تفعيل الاشتراك لمدة ${days} يوم`);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }
  async function deactivate(userId: string) {
    if (!confirm("تعطيل حساب هذا المستخدم؟")) return;
    setBusy(userId);
    const { error } = await supabase.rpc("deactivate_subscription", { _user_id: userId });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("تم التعطيل");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  if (adminLoading) return <div className="px-5 pt-8">جاري التحميل...</div>;
  if (!iAmAdmin) return <div className="px-5 pt-8"><div className="glass rounded-2xl p-6 text-center text-sm">هذه الصفحة للمدراء فقط</div></div>;

  return (
    <div className="px-5 pt-8">
      <div className="mb-5 flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-black">لوحة الإدارة</h1>
          <p className="text-xs text-muted-foreground">{users?.length ?? 0} مستخدم</p>
        </div>
      </div>

      <div className="space-y-3">
        {users?.map((u, i) => (
          <motion.div key={u.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="glass rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
                <UserIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold">{u.full_name || "بلا اسم"}</p>
                  {u.role === "admin" && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-bold text-primary">مدير</span>}
                  {u.is_active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold text-success"><CheckCircle2 className="h-2.5 w-2.5" />مفعّل</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-0.5 text-[9px] font-bold text-destructive"><XCircle className="h-2.5 w-2.5" />معطّل</span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="ltr">{u.email}</p>
                {u.expires_at && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    ينتهي: {new Date(u.expires_at).toLocaleDateString("ar-EG")}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button disabled={busy === u.id} onClick={() => activate(u.id, 20)} className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
                <Zap className="ml-1 inline h-3 w-3" />٢٠ يوم
              </button>
              <button disabled={busy === u.id} onClick={() => { const d = prompt("عدد الأيام:", "30"); if (d) activate(u.id, parseInt(d)); }} className="flex-1 rounded-lg bg-muted px-3 py-1.5 text-[11px] font-bold disabled:opacity-50">
                <RefreshCw className="ml-1 inline h-3 w-3" />مخصص
              </button>
              <button disabled={busy === u.id} onClick={() => deactivate(u.id)} className="flex-1 rounded-lg bg-destructive/20 px-3 py-1.5 text-[11px] font-bold text-destructive disabled:opacity-50">
                <Ban className="ml-1 inline h-3 w-3" />تعطيل
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
