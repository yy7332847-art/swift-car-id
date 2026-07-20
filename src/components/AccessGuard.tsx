import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getMySubscription, isAdmin as checkAdmin } from "@/lib/subscription-check";

const ALLOWED_WHEN_BLOCKED = ["/status", "/packages", "/account"];

export function AccessGuard({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { location } = useRouterState();
  const { data: sub, isLoading } = useQuery({ queryKey: ["sub"], queryFn: getMySubscription, staleTime: 60_000 });
  const { data: admin } = useQuery({ queryKey: ["is-admin"], queryFn: checkAdmin, staleTime: 60_000 });

  useEffect(() => {
    if (isLoading || !sub) return;
    if (admin) return; // admins bypass
    const path = location.pathname;
    const blocked = !sub.active;
    const allowed = ALLOWED_WHEN_BLOCKED.some((p) => path.startsWith(p)) || path.startsWith("/admin");
    if (blocked && !allowed) {
      navigate({ to: "/status", replace: true });
    }
  }, [sub, admin, isLoading, location.pathname, navigate]);

  return <>{children}</>;
}
