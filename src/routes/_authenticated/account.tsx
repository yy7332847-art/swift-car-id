import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMySubscription, isAdmin } from "@/lib/subscription-check";
import { LogOut, User as UserIcon, Mail, Clock, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

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
          {sub?.active ? (
            <>
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="font-bold text-success">مفعّل</p>
                {sub.daysLeft !== null && <p className="text-xs text-muted-foreground">متبقٍ {sub.daysLeft} يوم</p>}
              </div>
            </>
          ) : (
            <>
              <XCircle className="h-6 w-6 text-destructive" />
              <div>
                <p className="font-bold text-destructive">غير مفعّل</p>
                <p className="text-xs text-muted-foreground">تواصل مع الإدارة للتفعيل</p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="glass mb-4 rounded-2xl p-4 text-sm">
        <InfoRow icon={Mail} label="البريد" value={profile?.email ?? ""} />
        <InfoRow icon={Clock} label="تاريخ الإنشاء" value={profile?.created_at ? new Date(profile.created_at).toLocaleDateString("ar-EG") : ""} />
      </div>

      <button onClick={signOut} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-destructive py-3 text-sm font-black text-destructive-foreground">
        <LogOut className="h-4 w-4" /> تسجيل الخروج
      </button>
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
