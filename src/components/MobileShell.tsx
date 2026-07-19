import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Upload, Mic, ListChecks, User, ShieldCheck } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Tab {
  to: string;
  label: string;
  icon: typeof Home;
  center?: boolean;
}

const baseTabs: Tab[] = [
  { to: "/home", label: "الرئيسية", icon: Home },
  { to: "/upload", label: "رفع", icon: Upload },
  { to: "/record", label: "تسجيل", icon: Mic, center: true },
  { to: "/sessions", label: "الجلسات", icon: ListChecks },
  { to: "/account", label: "حسابي", icon: User },
];

export function MobileShell({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
    })();
  }, []);

  const tabs = isAdmin
    ? [...baseTabs.slice(0, 4), { to: "/admin", label: "الإدارة", icon: ShieldCheck }, baseTabs[4]]
    : baseTabs;

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col">
      <main className="flex-1 overflow-y-auto pb-28">{children}</main>
      <nav className="fixed bottom-3 left-1/2 z-50 w-[calc(100%-1.5rem)] max-w-[420px] -translate-x-1/2 rounded-2xl glass px-2 py-2 shadow-2xl">
        <div className="flex items-end justify-around">
          {tabs.map((t) => {
            const active = location.pathname === t.to || (t.to !== "/home" && location.pathname.startsWith(t.to));
            const Icon = t.icon;
            if (t.center) {
              return (
                <Link key={t.to} to={t.to} className="-mt-8 flex flex-col items-center gap-1">
                  <span className={`grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-all ${active ? "glow-primary scale-110" : ""}`}>
                    <Icon className="h-6 w-6" strokeWidth={2.5} />
                  </span>
                  <span className={`text-[10px] font-bold ${active ? "text-primary" : "text-muted-foreground"}`}>{t.label}</span>
                </Link>
              );
            }
            return (
              <Link key={t.to} to={t.to} className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
                <span className={`truncate text-[10px] ${active ? "font-bold" : ""}`}>{t.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
