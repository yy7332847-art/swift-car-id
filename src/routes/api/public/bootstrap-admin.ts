import { createFileRoute } from "@tanstack/react-router";

// One-time bootstrap: if no admin exists, create default admin.
// Safe to call multiple times — idempotent.
export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Check if any admin exists
        const { data: existing } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin").limit(1);
        if (existing && existing.length > 0) {
          return Response.json({ status: "admin_exists", message: "Admin already configured" });
        }
        const email = "admin@platecheck.app";
        const password = "Admin@Platecheck2026!";

        // Try to create user
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: "المدير" },
        });
        let userId = created?.user?.id;
        if (createErr) {
          if (!createErr.message.toLowerCase().includes("already")) {
            return Response.json({ error: createErr.message }, { status: 500 });
          }
          const { data: list } = await supabaseAdmin.auth.admin.listUsers();
          userId = list.users.find((u) => u.email === email)?.id;
        }
        if (!userId) return Response.json({ error: "no user id" }, { status: 500 });

        // Promote to admin
        await supabaseAdmin.from("user_roles").upsert({ user_id: userId, role: "admin" }, { onConflict: "user_id,role" });
        // Activate long subscription
        await supabaseAdmin.from("subscriptions").upsert({
          user_id: userId,
          is_active: true,
          starts_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "user_id" });

        return Response.json({ status: "admin_created", email, password, message: "Admin ready. Sign in and delete this endpoint response from logs." });
      },
    },
  },
});
