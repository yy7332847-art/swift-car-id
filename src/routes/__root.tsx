import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { THEME_INIT_SCRIPT } from "../lib/theme";
import { Toaster } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { NativeSafeErrorBoundary } from "@/components/NativeSafeErrorBoundary";
import { registerPWA } from "@/lib/pwa";
import { INSTALL_PROMPT_CAPTURE_SCRIPT } from "@/lib/install-prompt";


function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-sm rounded-3xl p-8 text-center">
        <h1 className="text-6xl font-black text-primary">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">الصفحة غير موجودة</p>
        <Link to="/" className="mt-6 inline-flex rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">
          العودة للرئيسية
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "root" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-sm rounded-3xl p-8 text-center">
        <h1 className="text-xl font-bold">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm text-muted-foreground">حاول تحديث الصفحة أو العودة للرئيسية.</p>
        <div className="mt-5 flex justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">إعادة المحاولة</button>
          <a href="/" className="rounded-xl border border-border px-4 py-2 text-sm">الرئيسية</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      { title: "تشييك اللوحات — نظام تعرّف صوتي على لوحات السيارات" },
      { name: "description", content: "نظام موبايل احترافي لمحصّلي البنوك: رفع ملفات لوحات ثم مطابقة صوتية فورية بالعربية" },
      { name: "theme-color", content: "#0f172a" },
      { property: "og:title", content: "تشييك اللوحات — نظام تعرّف صوتي على لوحات السيارات" },
      { property: "og:description", content: "نظام موبايل احترافي لمحصّلي البنوك: رفع ملفات لوحات ثم مطابقة صوتية فورية بالعربية" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "تشييك اللوحات — نظام تعرّف صوتي على لوحات السيارات" },
      { name: "twitter:description", content: "نظام موبايل احترافي لمحصّلي البنوك: رفع ملفات لوحات ثم مطابقة صوتية فورية بالعربية" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3263ea0a-f4dc-4499-8e0a-2041048a97ba/id-preview-2c530d3e--bf7273b0-0155-484f-aaea-e301b920547e.lovable.app-1784546192359.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/3263ea0a-f4dc-4499-8e0a-2041048a97ba/id-preview-2c530d3e--bf7273b0-0155-484f-aaea-e301b920547e.lovable.app-1784546192359.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png", sizes: "180x180" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_PROMPT_CAPTURE_SCRIPT }} />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}


function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);
  useEffect(() => { void registerPWA(); }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <NativeSafeErrorBoundary>
        <Outlet />
      </NativeSafeErrorBoundary>
      <Toaster position="top-center" richColors closeButton dir="rtl" />
    </QueryClientProvider>
  );
}

