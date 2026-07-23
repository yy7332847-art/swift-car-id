import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { motion } from "motion/react";
import {
  ShieldCheck, User as UserIcon, CheckCircle2, XCircle, Ban, Users, Package as PackageIcon,
  Inbox, Trash2, Plus, Pencil, Save, ShieldOff, Sparkles, Gift, Send, Clock, AlertTriangle, History,
} from "lucide-react";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "لوحة الإدارة — مجدي للتشييك" },
      { name: "description", content: "إدارة المستخدمين والباقات وطلبات الشراء وسجل العمليات." },
      { property: "og:title", content: "لوحة الإدارة — مجدي للتشييك" },
      { property: "og:description", content: "تحكم في الاشتراكات والباقات وموافقات المستخدمين من لوحة الإدارة." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

type Tab = "users" | "packages" | "requests" | "audit";

function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const { data: iAmAdmin, isLoading: adminLoading } = useQuery({
    queryKey: ["is-admin-check"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return false;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
      return !!data;
    },
  });

  if (adminLoading) return <div className="px-5 pt-8">جاري التحميل...</div>;
  if (!iAmAdmin) return <div className="px-5 pt-8"><div className="glass rounded-2xl p-6 text-center text-sm">هذه الصفحة للمدراء فقط</div></div>;

  return (
    <div className="px-5 pt-6 pb-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h1 className="text-xl font-black">لوحة الإدارة</h1>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2 rounded-2xl bg-muted/50 p-1">
        <TabBtn active={tab === "users"} onClick={() => setTab("users")} icon={Users} label="المستخدمون" />
        <TabBtn active={tab === "packages"} onClick={() => setTab("packages")} icon={PackageIcon} label="الباقات" />
        <TabBtn active={tab === "requests"} onClick={() => setTab("requests")} icon={Inbox} label="الطلبات" />
        <TabBtn active={tab === "audit"} onClick={() => setTab("audit")} icon={History} label="السجل" />
      </div>

      {tab === "users" && <UsersTab />}
      {tab === "packages" && <PackagesTab />}
      {tab === "requests" && <RequestsTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Users; label: string }) {
  return (
    <button onClick={onClick} className={`flex items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-black transition ${active ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground"}`}>
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

// ------------------- USERS -------------------
interface UserRow {
  id: string; email: string | null; full_name: string | null;
  status: string; is_active: boolean; expires_at: string | null;
  package_name: string | null; role: string; suspend_reason: string | null;
}

function UsersTab() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [suspendFor, setSuspendFor] = useState<string | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const { data: packages } = useQuery({
    queryKey: ["pkgs-admin"],
    queryFn: async () => (await supabase.from("packages").select("id, name, duration_days, is_free").eq("is_active", true).order("sort_order")).data ?? [],
  });

  const { data: users } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: subs }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }),
        supabase.from("subscriptions").select("user_id, is_active, expires_at, status, suspend_reason, packages(name)"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      const subMap = new Map((subs ?? []).map((s) => [s.user_id, s]));
      const roleMap = new Map<string, string>();
      for (const r of roles ?? []) roleMap.set(r.user_id, r.role);
      return (profiles ?? []).map((p) => {
        const s = subMap.get(p.id);
        const pkg = (s as { packages?: { name?: string } | null } | undefined)?.packages;
        return {
          id: p.id, email: p.email, full_name: p.full_name,
          status: s?.status ?? "inactive", is_active: !!s?.is_active,
          expires_at: s?.expires_at ?? null,
          package_name: pkg?.name ?? null,
          role: roleMap.get(p.id) ?? "user",
          suspend_reason: s?.suspend_reason ?? null,
        };
      });
    },
  });

  async function activate(userId: string, packageId: string) {
    setBusy(userId);
    const { error } = await supabase.rpc("admin_activate_package", { _user_id: userId, _package_id: packageId } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("تم تفعيل الباقة");
    setAssignFor(null);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }
  async function suspend(userId: string) {
    if (!suspendReason.trim()) return toast.error("اكتب سبب التعطيل");
    setBusy(userId);
    const { error } = await supabase.rpc("admin_suspend_user", { _user_id: userId, _reason: suspendReason } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("تم التعطيل");
    setSuspendFor(null); setSuspendReason("");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }
  async function unsuspend(userId: string) {
    setBusy(userId);
    const { error } = await supabase.rpc("admin_unsuspend_user", { _user_id: userId } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("تم رفع التعطيل");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }
  async function setRole(userId: string, role: "admin" | "user") {
    if (!confirm(role === "admin" ? "ترقية هذا المستخدم لمدير؟" : "إزالة صلاحيات المدير؟")) return;
    setBusy(userId);
    const { error } = await supabase.rpc("admin_set_role", { _user_id: userId, _role: role } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("تم التحديث");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">{users?.length ?? 0} مستخدم</p>
      {users?.map((u, i) => (
        <motion.div key={u.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }} className="glass rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted"><UserIcon className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="font-bold">{u.full_name || "بلا اسم"}</p>
                {u.role === "admin" && <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[9px] font-bold text-primary">مدير</span>}
                <StatusPill status={u.status} active={u.is_active} />
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="ltr">{u.email}</p>
              {u.package_name && <p className="mt-1 text-[10px]">الباقة: <span className="font-bold">{u.package_name}</span></p>}
              {u.expires_at && <p className="text-[10px] text-muted-foreground">ينتهي: {new Date(u.expires_at).toLocaleDateString("ar-EG")}</p>}
              {u.suspend_reason && <p className="mt-1 text-[10px] text-destructive">سبب: {u.suspend_reason}</p>}
            </div>
          </div>

          {assignFor === u.id ? (
            <div className="mt-3 space-y-1.5">
              {packages?.map((p) => (
                <button key={p.id} disabled={busy === u.id} onClick={() => activate(u.id, p.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-muted px-3 py-2 text-[11px] font-bold disabled:opacity-50">
                  <span className="flex items-center gap-1">{p.is_free ? <Gift className="h-3 w-3 text-success" /> : <Sparkles className="h-3 w-3 text-primary" />} {p.name}</span>
                  <span className="text-muted-foreground">{p.duration_days} يوم</span>
                </button>
              ))}
              <button onClick={() => setAssignFor(null)} className="w-full rounded-lg bg-muted px-3 py-1.5 text-[10px]">إلغاء</button>
            </div>
          ) : suspendFor === u.id ? (
            <div className="mt-3 space-y-2">
              <input value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="سبب التعطيل" className="w-full rounded-lg bg-muted px-3 py-2 text-xs" />
              <div className="flex gap-2">
                <button disabled={busy === u.id} onClick={() => suspend(u.id)} className="flex-1 rounded-lg bg-destructive py-2 text-[11px] font-black text-destructive-foreground disabled:opacity-50">تأكيد التعطيل</button>
                <button onClick={() => { setSuspendFor(null); setSuspendReason(""); }} className="rounded-lg bg-muted px-3 py-2 text-[11px]">إلغاء</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button disabled={busy === u.id} onClick={() => setAssignFor(u.id)} className="rounded-lg bg-primary px-2 py-1.5 text-[11px] font-bold text-primary-foreground disabled:opacity-50">
                <PackageIcon className="ml-1 inline h-3 w-3" /> تفعيل باقة
              </button>
              {u.status === "suspended" ? (
                <button disabled={busy === u.id} onClick={() => unsuspend(u.id)} className="rounded-lg bg-success/20 px-2 py-1.5 text-[11px] font-bold text-success disabled:opacity-50">
                  <CheckCircle2 className="ml-1 inline h-3 w-3" /> رفع التعطيل
                </button>
              ) : (
                <button disabled={busy === u.id} onClick={() => setSuspendFor(u.id)} className="rounded-lg bg-destructive/20 px-2 py-1.5 text-[11px] font-bold text-destructive disabled:opacity-50">
                  <Ban className="ml-1 inline h-3 w-3" /> تعطيل
                </button>
              )}
              {u.role === "admin" ? (
                <button disabled={busy === u.id} onClick={() => setRole(u.id, "user")} className="col-span-2 rounded-lg bg-muted px-2 py-1.5 text-[11px] font-bold disabled:opacity-50">
                  <ShieldOff className="ml-1 inline h-3 w-3" /> إزالة صلاحيات المدير
                </button>
              ) : (
                <button disabled={busy === u.id} onClick={() => setRole(u.id, "admin")} className="col-span-2 rounded-lg bg-muted px-2 py-1.5 text-[11px] font-bold disabled:opacity-50">
                  <ShieldCheck className="ml-1 inline h-3 w-3" /> ترقية لمدير
                </button>
              )}
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function StatusPill({ status, active }: { status: string; active: boolean }) {
  if (status === "suspended") return <span className="inline-flex items-center gap-1 rounded-full bg-destructive/20 px-2 py-0.5 text-[9px] font-bold text-destructive"><Ban className="h-2.5 w-2.5" />معطّل</span>;
  if (status === "expired") return <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[9px] font-bold text-warning"><Clock className="h-2.5 w-2.5" />منتهي</span>;
  if (status === "trial") return <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold text-success"><Gift className="h-2.5 w-2.5" />تجريبي</span>;
  if (active) return <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[9px] font-bold text-success"><CheckCircle2 className="h-2.5 w-2.5" />مفعّل</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground"><XCircle className="h-2.5 w-2.5" />غير مفعّل</span>;
}

// ------------------- PACKAGES -------------------
interface PkgRow {
  id: string; name: string; description: string | null; duration_days: number;
  price_egp: number; is_free: boolean; is_active: boolean; sort_order: number;
}

function PackagesTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<PkgRow>>({});
  const [creating, setCreating] = useState(false);

  const { data: pkgs } = useQuery({
    queryKey: ["admin-packages"],
    queryFn: async () => (await supabase.from("packages").select("*").order("sort_order")).data as PkgRow[] ?? [],
  });

  function startEdit(p: PkgRow) { setEditing(p.id); setForm(p); setCreating(false); }
  function startCreate() { setCreating(true); setEditing(null); setForm({ name: "", duration_days: 30, price_egp: 0, is_free: false, is_active: true, sort_order: (pkgs?.length ?? 0) }); }

  async function save() {
    if (!form.name || !form.duration_days) return toast.error("الاسم والمدة مطلوبان");
    const payload = {
      name: form.name, description: form.description ?? null,
      duration_days: Number(form.duration_days), price_egp: Number(form.price_egp ?? 0),
      is_free: !!form.is_free, is_active: form.is_active ?? true, sort_order: Number(form.sort_order ?? 0),
    };
    const { error } = creating
      ? await supabase.from("packages").insert(payload)
      : await supabase.from("packages").update(payload).eq("id", editing!);
    if (error) return toast.error(error.message);
    toast.success("تم الحفظ");
    setEditing(null); setCreating(false); setForm({});
    qc.invalidateQueries({ queryKey: ["admin-packages"] });
    qc.invalidateQueries({ queryKey: ["packages"] });
  }
  async function del(id: string) {
    if (!confirm("حذف هذه الباقة؟")) return;
    const { error } = await supabase.from("packages").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم الحذف");
    qc.invalidateQueries({ queryKey: ["admin-packages"] });
  }

  return (
    <div className="space-y-3">
      <button onClick={startCreate} className="flex w-full items-center justify-center gap-1 rounded-2xl bg-primary py-2.5 text-xs font-black text-primary-foreground">
        <Plus className="h-3.5 w-3.5" /> إضافة باقة
      </button>

      {(creating || editing) && (
        <div className="glass space-y-2 rounded-2xl p-4">
          <Input label="الاسم" value={form.name ?? ""} onChange={(v) => setForm({ ...form, name: v })} />
          <Input label="الوصف" value={form.description ?? ""} onChange={(v) => setForm({ ...form, description: v })} />
          <div className="grid grid-cols-2 gap-2">
            <Input label="المدة (يوم)" type="number" value={String(form.duration_days ?? "")} onChange={(v) => setForm({ ...form, duration_days: Number(v) })} />
            <Input label="السعر (ج.م)" type="number" value={String(form.price_egp ?? "")} onChange={(v) => setForm({ ...form, price_egp: Number(v) })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input label="الترتيب" type="number" value={String(form.sort_order ?? 0)} onChange={(v) => setForm({ ...form, sort_order: Number(v) })} />
            <label className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
              <input type="checkbox" checked={!!form.is_free} onChange={(e) => setForm({ ...form, is_free: e.target.checked })} /> باقة مجانية
            </label>
          </div>
          <label className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs">
            <input type="checkbox" checked={form.is_active ?? true} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> نشطة
          </label>
          <div className="flex gap-2">
            <button onClick={save} className="flex-1 rounded-lg bg-primary py-2 text-xs font-black text-primary-foreground"><Save className="ml-1 inline h-3 w-3" /> حفظ</button>
            <button onClick={() => { setEditing(null); setCreating(false); }} className="rounded-lg bg-muted px-3 py-2 text-xs font-bold">إلغاء</button>
          </div>
        </div>
      )}

      {pkgs?.map((p) => (
        <div key={p.id} className="glass rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${p.is_free ? "bg-success/20 text-success" : "bg-primary/20 text-primary"}`}>
              {p.is_free ? <Gift className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-black">{p.name}</p>
                {!p.is_active && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold text-muted-foreground">موقوفة</span>}
              </div>
              {p.description && <p className="text-[11px] text-muted-foreground">{p.description}</p>}
              <p className="mt-1 text-xs"><span className="font-black">{p.is_free ? "مجاناً" : `${p.price_egp} ج.م`}</span> <span className="text-muted-foreground">/ {p.duration_days} يوم</span></p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => startEdit(p)} className="flex-1 rounded-lg bg-muted py-1.5 text-[11px] font-bold"><Pencil className="ml-1 inline h-3 w-3" /> تعديل</button>
            <button onClick={() => del(p.id)} className="flex-1 rounded-lg bg-destructive/20 py-1.5 text-[11px] font-bold text-destructive"><Trash2 className="ml-1 inline h-3 w-3" /> حذف</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Input({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg bg-muted px-3 py-2 text-xs" />
    </label>
  );
}

// ------------------- REQUESTS -------------------
function RequestsTab() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data: reqs } = useQuery({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_requests")
        .select("id, user_id, package_id, note, contact, status, admin_note, created_at, packages(name, price_egp, duration_days), profiles!purchase_requests_user_id_fkey(full_name, email)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  async function process(id: string, approve: boolean) {
    setBusy(id);
    const { error } = await supabase.rpc("admin_process_request", { _request_id: id, _approve: approve, _admin_note: note || null } as never);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(approve ? "تم القبول والتفعيل" : "تم الرفض");
    setNoteFor(null); setNote("");
    qc.invalidateQueries({ queryKey: ["admin-requests"] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  if (!reqs || reqs.length === 0) return <p className="glass rounded-2xl p-6 text-center text-xs text-muted-foreground">لا توجد طلبات</p>;

  return (
    <div className="space-y-3">
      {reqs.map((r) => {
        const pkg = (r as { packages?: { name?: string; price_egp?: number; duration_days?: number } | null }).packages;
        const prof = (r as { profiles?: { full_name?: string; email?: string } | null }).profiles;
        return (
          <div key={r.id} className="glass rounded-2xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{prof?.full_name || "-"}</p>
                <p className="truncate text-[10px] text-muted-foreground" dir="ltr">{prof?.email}</p>
                <p className="mt-2 text-xs">
                  الباقة: <span className="font-black">{pkg?.name}</span> · {pkg?.price_egp} ج.م / {pkg?.duration_days} يوم
                </p>
                {r.contact && <p className="mt-1 text-[10px]">تواصل: <span dir="ltr">{r.contact}</span></p>}
                {r.note && <p className="mt-1 text-[10px] text-muted-foreground">ملاحظة: {r.note}</p>}
                <p className="mt-1 text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString("ar-EG")}</p>
              </div>
              {r.status === "pending" ? (
                <span className="rounded-full bg-warning/20 px-2 py-1 text-[9px] font-bold text-warning"><AlertTriangle className="ml-0.5 inline h-2.5 w-2.5" />قيد المراجعة</span>
              ) : r.status === "approved" ? (
                <span className="rounded-full bg-success/20 px-2 py-1 text-[9px] font-bold text-success">مقبول</span>
              ) : (
                <span className="rounded-full bg-destructive/20 px-2 py-1 text-[9px] font-bold text-destructive">مرفوض</span>
              )}
            </div>
            {r.status === "pending" && (
              noteFor === r.id ? (
                <div className="mt-3 space-y-2">
                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" className="w-full rounded-lg bg-muted px-3 py-2 text-xs" />
                  <div className="flex gap-2">
                    <button disabled={busy === r.id} onClick={() => process(r.id, true)} className="flex-1 rounded-lg bg-success py-2 text-[11px] font-black text-white disabled:opacity-50"><Send className="ml-1 inline h-3 w-3" /> قبول وتفعيل</button>
                    <button disabled={busy === r.id} onClick={() => process(r.id, false)} className="flex-1 rounded-lg bg-destructive py-2 text-[11px] font-black text-destructive-foreground disabled:opacity-50">رفض</button>
                    <button onClick={() => { setNoteFor(null); setNote(""); }} className="rounded-lg bg-muted px-3 py-2 text-[11px]">إلغاء</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setNoteFor(r.id)} className="mt-3 w-full rounded-lg bg-primary py-2 text-[11px] font-black text-primary-foreground">معالجة الطلب</button>
              )
            )}
            {r.admin_note && r.status !== "pending" && (
              <p className="mt-2 text-[10px] text-muted-foreground">ملاحظة الإدارة: {r.admin_note}</p>
            )}
          </div>
        );
      })}
      <div className="pt-2 text-center">
        <Link to="/admin" className="text-[10px] text-muted-foreground">تحديث</Link>
      </div>
    </div>
  );
}

// ------------------- AUDIT LOG -------------------
interface AuditRow {
  id: string; admin_id: string; target_user_id: string | null;
  action: string; details: Record<string, unknown>; created_at: string;
}

const ACTION_LABELS: Record<string, string> = {
  activate_package: "تفعيل باقة",
  suspend_user: "تعطيل مستخدم",
  unsuspend_user: "إعادة تفعيل",
  approve_request: "قبول طلب",
  reject_request: "رفض طلب",
};

function AuditTab() {
  const { data: rows } = useQuery({
    queryKey: ["admin-audit"],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data } = await supabase
        .from("admin_audit_log" as never)
        .select("id, admin_id, target_user_id, action, details, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      return (data ?? []) as unknown as AuditRow[];
    },
  });
  const { data: profiles } = useQuery({
    queryKey: ["profiles-names"],
    queryFn: async () => (await supabase.from("profiles").select("id, full_name, email")).data ?? [],
  });
  const nameMap = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)]));

  if (!rows) return <p className="text-center text-xs text-muted-foreground">جاري التحميل...</p>;
  if (rows.length === 0) return <p className="glass rounded-2xl p-6 text-center text-xs text-muted-foreground">لا توجد سجلات</p>;

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const label = ACTION_LABELS[r.action] ?? r.action;
        const tone = r.action.startsWith("suspend") || r.action === "reject_request"
          ? "bg-destructive/15 text-destructive"
          : r.action === "approve_request" || r.action === "activate_package"
            ? "bg-success/15 text-success"
            : "bg-primary/15 text-primary";
        return (
          <div key={r.id} className="glass rounded-xl p-3">
            <div className="flex items-start gap-2">
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${tone}`}>{label}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px]">
                  <span className="text-muted-foreground">من:</span> <span className="font-bold">{nameMap.get(r.admin_id) ?? "-"}</span>
                  {r.target_user_id && <> <span className="text-muted-foreground">← إلى:</span> <span className="font-bold">{nameMap.get(r.target_user_id) ?? "-"}</span></>}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(r.created_at).toLocaleString("ar-EG")}</p>
                {Object.keys(r.details ?? {}).length > 0 && (
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-2 text-[9.5px]" dir="ltr">{JSON.stringify(r.details, null, 1)}</pre>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
