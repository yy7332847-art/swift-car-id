import { useEffect, useState } from "react";
import { Download, CheckCircle2, Share, Plus } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
}

function isCapacitorNative() {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.();
}

/**
 * Install-as-app button. Behavior:
 * - Chrome/Edge/Android: uses `beforeinstallprompt` for a one-tap native install.
 * - iOS Safari: shows a small guide (Share → Add to Home Screen).
 * - Already installed / Capacitor native / unsupported: hides itself.
 */
export function InstallPWAButton({ className = "" }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isCapacitorNative()) return; // Already inside a native shell
    if (isStandalone()) {
      setInstalled(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => {
      setInstalled(true);
      setDeferred(null);
      toast.success("تم تثبيت التطبيق بنجاح");
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (isCapacitorNative() || installed) return null;

  const supportsPrompt = !!deferred;
  const iosFallback = isIOS() && !supportsPrompt;

  async function handleInstall() {
    if (deferred) {
      setBusy(true);
      try {
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === "accepted") {
          toast.success("جاري التثبيت...");
        } else {
          toast("تم إلغاء التثبيت");
        }
      } catch {
        toast.error("تعذّر بدء التثبيت");
      } finally {
        setDeferred(null);
        setBusy(false);
      }
      return;
    }
    if (iosFallback) {
      setShowIOSHelp(true);
      return;
    }
    toast("متصفحك لا يدعم التثبيت التلقائي. افتح القائمة واختر «تثبيت التطبيق».");
  }

  // If the browser hasn't fired beforeinstallprompt yet AND it's not iOS,
  // still show the button — many browsers fire the event only after user gesture.
  return (
    <>
      <motion.button
        type="button"
        onClick={handleInstall}
        disabled={busy}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        className={
          "group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary/70 px-5 py-3 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-shadow hover:shadow-primary/50 disabled:opacity-60 " +
          className
        }
      >
        <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
        <Download className="h-4 w-4" />
        <span>ثبّت التطبيق على جهازك</span>
      </motion.button>

      <AnimatePresence>
        {showIOSHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
            onClick={() => setShowIOSHelp(false)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-t-3xl bg-card p-6 text-card-foreground shadow-2xl sm:rounded-3xl"
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-muted sm:hidden" />
              <div className="mb-3 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-black">تثبيت على iPhone</h3>
              </div>
              <ol className="space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">1</span>
                  <span className="flex items-center gap-1">اضغط زر المشاركة <Share className="inline h-4 w-4" /> في شريط Safari.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">2</span>
                  <span className="flex items-center gap-1">اختر «إضافة إلى الشاشة الرئيسية» <Plus className="inline h-4 w-4" />.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">3</span>
                  <span>اضغط «إضافة» — سيظهر التطبيق على شاشتك الرئيسية.</span>
                </li>
              </ol>
              <button
                onClick={() => setShowIOSHelp(false)}
                className="mt-5 w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
              >
                فهمت
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
