import { useEffect, useState } from "react";
import { Wifi, WifiOff, CloudUpload, RefreshCw, Loader2, Database, CheckCircle2, AlertCircle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { subscribeSync, syncNow, refreshPlatesCache, type SyncState } from "@/lib/sync-queue";
import { platesCacheInfo, isIndexedDBAvailable } from "@/lib/offline-store";
import { toast } from "sonner";

export function ConnectivityIndicator() {
  const [s, setS] = useState<SyncState | null>(null);
  const [cache, setCache] = useState<{ user_id: string; count: number; at: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeSync(setS), []);
  useEffect(() => {
    if (!isIndexedDBAvailable()) return;
    void platesCacheInfo().then(setCache);
  }, [s?.lastSyncAt]);

  if (!s) return null;

  const pending = s.pendingSessions + s.pendingPlates;
  const tone = !s.online ? "offline" : pending > 0 || s.syncing ? "pending" : "ok";
  const toneCls =
    tone === "offline"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "pending"
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-success/40 bg-success/10 text-success";
  const Icon = !s.online ? WifiOff : s.syncing ? Loader2 : pending > 0 ? CloudUpload : Wifi;

  async function doSync() {
    setBusy(true);
    try {
      const r = await syncNow();
      if (r.pushed > 0) toast.success(`تمت مزامنة ${r.pushed} عنصر`);
      else if (r.failed > 0) toast.error(`فشل مزامنة ${r.failed} عنصر`);
      else toast("لا يوجد ما يُزامَن");
    } finally {
      setBusy(false);
    }
  }

  async function doRefreshCache() {
    setBusy(true);
    try {
      const r = await refreshPlatesCache();
      toast.success(`تم تحميل ${r.count.toLocaleString("ar-EG")} لوحة للاستخدام بدون إنترنت`);
      setCache(await platesCacheInfo());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحميل الكاش");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          aria-label="حالة الاتصال والمزامنة"
          className={`relative grid h-9 shrink-0 place-items-center rounded-xl border px-2 transition-all active:scale-95 ${toneCls}`}
        >
          <div className="flex items-center gap-1">
            <Icon className={`h-4 w-4 ${s.syncing ? "animate-spin" : ""}`} />
            {pending > 0 && !s.syncing && (
              <span className="min-w-[16px] rounded-full bg-current/20 px-1 text-[10px] font-black leading-4">
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </div>
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="text-right">
          <SheetTitle className="flex items-center gap-2">
            {s.online ? <Wifi className="h-5 w-5 text-success" /> : <WifiOff className="h-5 w-5 text-destructive" />}
            {s.online ? "متصل بالإنترنت" : "بدون إنترنت"}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <StatBox
              label="جلسات في الانتظار"
              value={s.pendingSessions}
              tone={s.pendingSessions > 0 ? "warning" : "muted"}
            />
            <StatBox
              label="لوحات في الانتظار"
              value={s.pendingPlates}
              tone={s.pendingPlates > 0 ? "warning" : "muted"}
            />
          </div>

          <div className="glass rounded-2xl border border-border/50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> آخر مزامنة
            </div>
            <p className="text-sm font-black">
              {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString("ar-EG") : "لم تتم بعد"}
            </p>
            {s.lastError && (
              <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                <AlertCircle className="h-3.5 w-3.5" /> {s.lastError}
              </p>
            )}
          </div>

          <div className="glass rounded-2xl border border-border/50 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
              <Database className="h-3.5 w-3.5" /> كاش اللوحات (للمطابقة بدون إنترنت)
            </div>
            {cache ? (
              <p className="text-sm font-black">
                {cache.count.toLocaleString("ar-EG")} لوحة —{" "}
                <span className="text-muted-foreground font-normal">{new Date(cache.at).toLocaleString("ar-EG")}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">لم يتم التحميل بعد</p>
            )}
          </div>

          <button
            onClick={doSync}
            disabled={busy || !s.online || s.syncing}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary p-3 text-sm font-black text-primary-foreground shadow-lg disabled:opacity-50"
          >
            {s.syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
            مزامنة الآن
          </button>
          <button
            onClick={doRefreshCache}
            disabled={busy || !s.online}
            className="glass flex items-center justify-center gap-2 rounded-2xl p-3 text-sm font-bold disabled:opacity-50"
          >
            <Database className="h-4 w-4 text-primary" />
            {cache ? "تحديث كاش اللوحات" : "تحميل كاش اللوحات للاستخدام بدون إنترنت"}
          </button>
          <p className="flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            عند عدم توفر إنترنت، يتم حفظ الجلسات واللوحات محلياً على جهازك، وتُرفع تلقائياً بمجرد رجوع الاتصال — لن تفقد أي بيانات.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatBox({ label, value, tone }: { label: string; value: number; tone: "warning" | "muted" }) {
  const cls = tone === "warning" ? "text-warning border-warning/40" : "text-muted-foreground border-border";
  return (
    <div className={`glass rounded-2xl border p-3 text-center ${cls}`}>
      <p className="text-2xl font-black tabular-nums">{value}</p>
      <p className="text-[10.5px] font-bold">{label}</p>
    </div>
  );
}
