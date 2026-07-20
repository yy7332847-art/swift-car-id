import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { getMySubscription } from "@/lib/subscription-check";
import { loadSettings } from "@/lib/settings";

const DISMISS_KEY = "platecheck:expiry-dismiss";

export function ExpiryBanner() {
  const { data: sub } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription, staleTime: 60_000 });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [settingsVer, setSettingsVer] = useState(0);

  useEffect(() => {
    setDismissed(typeof window !== "undefined" ? window.localStorage.getItem(DISMISS_KEY) : null);
    const onChange = () => setSettingsVer((v) => v + 1);
    window.addEventListener("platecheck:settings-changed", onChange);
    return () => window.removeEventListener("platecheck:settings-changed", onChange);
  }, []);

  const settings = loadSettings();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _rerender = settingsVer;

  if (!settings.expiryInAppNotify) return null;
  if (!sub || !sub.active || sub.daysLeft == null) return null;
  if (sub.daysLeft > settings.expiryNotifyDays) return null;

  // Dismiss key per-day so it reappears next day.
  const today = new Date().toISOString().slice(0, 10);
  const dismissToken = `${today}:${sub.daysLeft}`;
  if (dismissed === dismissToken) return null;

  const urgent = sub.daysLeft <= 1;

  return (
    <div className={`mx-auto mt-2 flex w-[calc(100%-1.5rem)] max-w-[420px] items-center gap-2 rounded-2xl border p-2.5 text-[11px] font-bold shadow-lg backdrop-blur-xl ${urgent ? "border-destructive/50 bg-destructive/15 text-destructive" : "border-warning/50 bg-warning/15 text-warning"}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        {sub.daysLeft === 0
          ? "باقتك تنتهي اليوم — جدّد الآن لتفادي التوقف."
          : `باقتك تنتهي خلال ${sub.daysLeft} ${sub.daysLeft === 1 ? "يوم" : "أيام"}.`}
      </div>
      <Link to="/packages" className="shrink-0 rounded-lg bg-foreground/10 px-2 py-1 text-[10px] font-black">
        تجديد
      </Link>
      <button
        onClick={() => { window.localStorage.setItem(DISMISS_KEY, dismissToken); setDismissed(dismissToken); }}
        aria-label="إخفاء"
        className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-foreground/10"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
