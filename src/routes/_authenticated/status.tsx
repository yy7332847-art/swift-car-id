import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMySubscription } from "@/lib/subscription-check";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Ban, Clock, LogOut, PackagePlus, Phone } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/status")({
  component: StatusPage,
});

function StatusPage() {
  const navigate = useNavigate();
  const { data: sub, isLoading } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription });

  if (isLoading) return <div className="px-5 pt-16 text-center text-sm text-muted-foreground">جاري التحميل...</div>;

  const suspended = sub?.status === "suspended";
  const expired = sub?.status === "expired";
  const inactive = sub?.status === "inactive";

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
    navigate({ to: "/auth" });
  }

  const Icon = suspended ? Ban : expired ? Clock : AlertTriangle;
  const color = suspended ? "destructive" : expired ? "warning" : "muted-foreground";
  const title = suspended ? "تم تعطيل حسابك" : expired ? "انتهت الباقة" : "لا يوجد اشتراك مفعّل";
  const desc = suspended
    ? "تم تعطيل حسابك من قِبل الإدارة. تواصل مع الدعم الفني لمزيد من التفاصيل."
    : expired
    ? "انتهت مدة اشتراكك الحالي. يمكنك تجديد اشتراكك أو اختيار باقة جديدة."
    : "لا يوجد اشتراك مفعّل على حسابك. اختر باقة للبدء.";

  return (
    <div className="min-h-[80vh] px-5 pt-10 pb-8">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass mx-auto max-w-sm rounded-3xl p-6 text-center">
        <div className={`mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-${color}/20 text-${color}`}>
          <Icon className="h-10 w-10" />
        </div>
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{desc}</p>

        {suspended && sub?.suspendReason && (
          <div className="mt-4 rounded-2xl bg-destructive/10 p-3 text-right">
            <p className="text-[10px] font-bold text-destructive">سبب التعطيل</p>
            <p className="mt-1 text-xs">{sub.suspendReason}</p>
          </div>
        )}

        {sub?.packageName && (expired || inactive) && (
          <p className="mt-3 text-[11px] text-muted-foreground">الباقة السابقة: <span className="font-bold text-foreground">{sub.packageName}</span></p>
        )}

        <div className="mt-6 space-y-2">
          {!suspended && (
            <Link to="/packages" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground">
              <PackagePlus className="h-4 w-4" /> عرض الباقات
            </Link>
          )}
          {suspended && (
            <a href="mailto:support@platecheck.app" className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3 text-sm font-black text-primary-foreground">
              <Phone className="h-4 w-4" /> تواصل مع الدعم
            </a>
          )}
          <button onClick={signOut} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-muted py-3 text-sm font-black">
            <LogOut className="h-4 w-4" /> تسجيل الخروج
          </button>
        </div>
      </motion.div>
    </div>
  );
}
