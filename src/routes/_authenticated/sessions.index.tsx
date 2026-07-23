import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "motion/react";
import { ListChecks, CheckCircle2, AlertTriangle, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/sessions/")({
  head: () => ({
    meta: [
      { title: "سجل الجلسات — مجدي للتشييك" },
      { name: "description", content: "عرض جلسات التعرّف السابقة مع ملخص التطابق والأخطاء والتقارير." },
      { property: "og:title", content: "سجل الجلسات — مجدي للتشييك" },
      { property: "og:description", content: "راجع جلساتك السابقة وافتح تقرير كل جلسة وخريطتها." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SessionsListPage,
});

function SessionsListPage() {
  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return [];
      const { data } = await supabase
        .from("recognition_sessions")
        .select("id, started_at, ended_at, total_detected, total_matched, total_incomplete")
        .eq("user_id", u.user.id)
        .order("started_at", { ascending: false });
      return data ?? [];
    },
  });

  return (
    <div className="px-5 pt-8">
      <h1 className="mb-1 text-2xl font-black">الجلسات</h1>
      <p className="mb-5 text-sm text-muted-foreground">سجل كامل لجلسات التعرّف</p>

      {sessions && sessions.length > 0 ? (
        <div className="space-y-2">
          {sessions.map((s, i) => (
            <motion.div key={s.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
              <Link to="/sessions/$id" params={{ id: s.id }} className="glass flex items-center gap-3 rounded-2xl p-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/20 text-primary">
                  <ListChecks className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{new Date(s.started_at).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</p>
                  <div className="mt-1 flex gap-3 text-[11px]">
                    <span className="text-muted-foreground">{s.total_detected} مكتشفة</span>
                    <span className="text-success"><CheckCircle2 className="ml-1 inline h-3 w-3" />{s.total_matched}</span>
                    <span className="text-warning"><AlertTriangle className="ml-1 inline h-3 w-3" />{s.total_incomplete}</span>
                  </div>
                </div>
                <ChevronLeft className="h-5 w-5 shrink-0 text-muted-foreground" />
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-muted/50 p-6 text-center text-sm text-muted-foreground">لا توجد جلسات بعد</p>
      )}
    </div>
  );
}
