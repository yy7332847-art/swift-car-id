// PWA service-worker registration with user-approved update flow.
// Safe in Lovable preview (refuses to register there), safe in Capacitor native.
import { toast } from "sonner";

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

async function unregisterAll(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
  await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
}

function promptUpdate(worker: ServiceWorker) {
  toast("تحديث جديد متاح", {
    description: "تم تجهيز نسخة أحدث من التطبيق. اضغط للتحديث الآن.",
    duration: Infinity,
    action: {
      label: "تحديث الآن",
      onClick: () => {
        worker.postMessage({ type: "SKIP_WAITING" });
      },
    },
  });
}

export async function registerPWA(): Promise<void> {
  if (shouldSkipRegistration()) {
    // Clean up any stale registration when in preview/dev
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator && !import.meta.env.PROD) {
      await unregisterAll();
    }
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });

    // Case 1: worker already waiting when we register (previous tab installed it)
    if (reg.waiting && navigator.serviceWorker.controller) {
      promptUpdate(reg.waiting);
    }

    // Case 2: new worker starts installing → wait until installed, then prompt
    reg.addEventListener("updatefound", () => {
      const installing = reg.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          promptUpdate(installing);
        }
      });
    });

    // Reload once when the new worker takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    // Periodic update check (every 60 min while tab open)
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  } catch (err) {
    console.warn("[pwa] SW registration failed", err);
  }
}
