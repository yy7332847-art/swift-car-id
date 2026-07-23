import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "مجدي للتشييك — مطابقة لوحات فورية" },
      { name: "description", content: "تطبيق PWA لمطابقة لوحات السيارات بالصوت ورفع ملفات Excel للمحصّلين." },
      { property: "og:title", content: "مجدي للتشييك — مطابقة لوحات فورية" },
      { property: "og:description", content: "ابدأ استخدام تطبيق مجدي للتشييك للتعرّف الصوتي الفوري على لوحات السيارات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/home" });
    throw redirect({ to: "/auth" });
  },
  component: () => null,
});
