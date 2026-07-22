import { toast } from "sonner";
import { registerSW } from "virtual:pwa-register";

type UpdateServiceWorker = (reloadPage?: boolean) => Promise<void>;

let started = false;
let updateServiceWorker: UpdateServiceWorker | undefined;

function shouldSkipRegistration(): boolean {
  if (typeof window === "undefined") return true;
  if (!("serviceWorker" in navigator)) return true;
  // Dev mode
  if (!import.meta.env.PROD) return true;
  // Inside iframe (Lovable editor preview)
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const host = window.location.hostname;
  if (host.startsWith("id-preview--") || host.startsWith("preview--")) return true;
  if (host === "lovableproject.com" || host.endsWith(".lovableproject.com")) return true;
  if (host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com")) return true;
  if (host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev")) return true;
  // Capacitor native — no SW inside file:///capacitor://
  const proto = window.location.protocol;
  if (proto === "file:" || proto === "capacitor:") return true;
  const w = window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } };
  if (w.Capacitor?.isNativePlatform?.()) return true;
  // Kill switch
  if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  return false;
}

function registrationScriptPath(reg: ServiceWorkerRegistration): string {
  const worker = reg.active ?? reg.waiting ?? reg.installing;
  if (!worker?.scriptURL) return "";
  try {
    return new URL(worker.scriptURL).pathname;
  } catch {
    return worker.scriptURL;
  }
}

async function unregisterAppShellWorkers(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(
    regs
      .filter((reg) => registrationScriptPath(reg).endsWith("/sw.js"))
      .map((reg) => reg.unregister().catch(() => false)),
  );
}

export async function registerPWA(): Promise<void> {
  if (shouldSkipRegistration()) {
    await unregisterAppShellWorkers();
    return;
  }
  if (started) return;
  started = true;

  try {
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        toast("تحديث جديد متاح", {
          description: "تم تجهيز نسخة أحدث من التطبيق. اضغط للتحديث الآن.",
          duration: Infinity,
          action: {
            label: "تحديث الآن",
            onClick: () => {
              void updateServiceWorker?.(true);
            },
          },
        });
      },
      onOfflineReady() {
        toast.success("التطبيق جاهز للعمل بدون إنترنت");
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
      },
      onRegisterError(error) {
        console.warn("[pwa] SW registration failed", error);
      },
    });
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}

export function isInstallContextBlocked(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
