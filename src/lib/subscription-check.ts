import { supabase } from "@/integrations/supabase/client";

export interface SubscriptionStatus {
  active: boolean;
  expiresAt: string | null;
  daysLeft: number | null;
}

export async function getMySubscription(): Promise<SubscriptionStatus> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return { active: false, expiresAt: null, daysLeft: null };
  const { data } = await supabase.from("subscriptions").select("is_active, expires_at").eq("user_id", u.user.id).maybeSingle();
  if (!data) return { active: false, expiresAt: null, daysLeft: null };
  const active = !!data.is_active && (!data.expires_at || new Date(data.expires_at) > new Date());
  let daysLeft: number | null = null;
  if (data.expires_at) {
    daysLeft = Math.max(0, Math.ceil((new Date(data.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }
  return { active, expiresAt: data.expires_at, daysLeft };
}

export async function isAdmin(): Promise<boolean> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return false;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!data;
}
