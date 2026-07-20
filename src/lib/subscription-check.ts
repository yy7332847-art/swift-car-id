import { supabase } from "@/integrations/supabase/client";

export type SubStatus = "trial" | "active" | "expired" | "suspended" | "inactive";

export interface SubscriptionStatus {
  active: boolean;
  status: SubStatus;
  expiresAt: string | null;
  daysLeft: number | null;
  packageId: string | null;
  packageName: string | null;
  suspendReason: string | null;
}

export async function getMySubscription(): Promise<SubscriptionStatus> {
  const empty: SubscriptionStatus = {
    active: false, status: "inactive", expiresAt: null, daysLeft: null,
    packageId: null, packageName: null, suspendReason: null,
  };
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return empty;
  const { data } = await supabase
    .from("subscriptions")
    .select("is_active, expires_at, status, package_id, suspend_reason, packages(name)")
    .eq("user_id", u.user.id)
    .maybeSingle();
  if (!data) return empty;

  const notExpired = !data.expires_at || new Date(data.expires_at) > new Date();
  let status = (data.status as SubStatus) ?? "inactive";
  if (status !== "suspended") {
    if (data.is_active && notExpired) status = status === "trial" ? "trial" : "active";
    else if (data.expires_at && !notExpired) status = "expired";
    else status = "inactive";
  }
  const active = status === "active" || status === "trial";
  let daysLeft: number | null = null;
  if (data.expires_at) {
    daysLeft = Math.max(0, Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / 86400000));
  }
  const pkg = (data as { packages?: { name?: string } | null }).packages;
  return {
    active, status, expiresAt: data.expires_at, daysLeft,
    packageId: data.package_id ?? null,
    packageName: pkg?.name ?? null,
    suspendReason: data.suspend_reason ?? null,
  };
}

export async function isAdmin(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!data;
}
