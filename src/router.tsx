import { QueryClient } from "@tanstack/react-query";
import { createHashHistory, createRouter, Link } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

function useNativeHashHistory() {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean } };
  return !!w.Capacitor?.isNativePlatform?.() || window.location.protocol === "file:" || window.location.protocol === "capacitor:";
}

function DefaultErrorComponent({ error }: { error: Error }) {
  console.error(error);
  return (
    <main className="flex min-h-screen items-center justify-center px-4" dir="rtl">
      <section className="max-w-sm rounded-2xl border border-border bg-card p-6 text-center text-card-foreground shadow-lg">
        <h1 className="text-lg font-bold">تعذر تشغيل الصفحة</h1>
        <p className="mt-2 text-sm text-muted-foreground">أغلق التطبيق وافتحه مرة أخرى، أو عد للرئيسية.</p>
        <Link to="/" className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
          الرئيسية
        </Link>
      </section>
    </main>
  );
}

export const getRouter = () => {
  const queryClient = new QueryClient();
  const history = useNativeHashHistory() ? createHashHistory() : undefined;

  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history ? { history } : {}),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
