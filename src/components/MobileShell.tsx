import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { Home, Upload, Mic, ListChecks, User, ShieldCheck, Moon, Sun, ScanLine, ChevronRight, RotateCw, Settings as SettingsIcon } from "lucide-react";

import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTheme } from "@/lib/theme";
import { ExpiryBanner } from "@/components/ExpiryBanner";

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

const TITLES: Record<string, string> = {
  "/home": "الرئيسية",
  "/upload": "رفع اللوحات",
  "/record": "التسجيل الصوتي",
  "/sessions": "الجلسات",
  "/account": "حسابي",
  "/admin": "لوحة الإدارة",
  "/settings": "الإعدادات",
};

export function MobileShell({ children }: { children: ReactNode }) {
  const { location } = useRouterState();
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [, , toggleTheme] = useTheme();
  const [theme, setThemeLocal] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setThemeLocal(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

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

  const currentTitle = Object.entries(TITLES).find(([p]) => location.pathname.startsWith(p))?.[1] ?? "تشييك اللوحات";
  const canGoBack = location.pathname !== "/home" && location.pathname !== "/";

  const handleToggle = () => {
    toggleTheme();
    setThemeLocal((t) => (t === "dark" ? "light" : "dark"));
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/60 backdrop-blur-2xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in oklch, var(--color-primary) 10%, transparent), transparent 70%)",
          }}
        />
        <div className="relative flex items-center gap-2.5 px-3.5 py-3">
          <Link
            to="/home"
            className="group flex items-center gap-2.5 min-w-0 flex-1"
            aria-label="الرئيسية"
          >
            <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-lg shadow-primary/25 transition-transform group-active:scale-95">
              <ScanLine className="h-5 w-5" strokeWidth={2.5} />
              <span className="absolute -inset-0.5 rounded-2xl opacity-0 blur-md transition-opacity group-hover:opacity-40" style={{ background: "var(--color-primary)" }} />
            </div>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-black tracking-tight">تشييك اللوحات</p>
              <p className="truncate text-[10.5px] text-muted-foreground">{currentTitle}</p>
            </div>
          </Link>

          {canGoBack && (
            <button
              onClick={() => router.history.back()}
              aria-label="رجوع"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-card/70 text-foreground/80 transition-all hover:bg-muted active:scale-95"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}

          <button
            onClick={() => router.invalidate()}
            aria-label="تحديث"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-card/70 text-foreground/80 transition-all hover:bg-muted active:scale-95 active:rotate-180"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          <button
            onClick={handleToggle}
            aria-label="تبديل الوضع"
            className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/15 to-accent/15 text-primary transition-all hover:from-primary/25 hover:to-accent/25 active:scale-95"
          >
            <Sun className={`absolute h-4 w-4 transition-all duration-500 ${theme === "dark" ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"}`} />
            <Moon className={`absolute h-4 w-4 transition-all duration-500 ${theme === "light" ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0"}`} />
          </button>
        </div>
        <ExpiryBanner />
      </header>

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
