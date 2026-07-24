import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Transcribe an uploaded audio blob using Lovable AI Gateway (openai/gpt-4o-transcribe).
// Requires Authorization: Bearer <supabase access token> — verified server-side.
export const Route = createFileRoute("/api/transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response(JSON.stringify({ error: "AI key not configured" }), { status: 500 });

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token || token.split(".").length !== 3) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
          return new Response(JSON.stringify({ error: "Auth not configured" }), { status: 500 });
        }
        try {
          const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
            auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await supabase.auth.getClaims(token);
          if (error || !data?.claims?.sub) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
          }
        } catch {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
        }

        const inForm = await request.formData();
        const audio = inForm.get("audio");
        if (!audio || typeof audio === "string") {
          return new Response(JSON.stringify({ error: "No audio" }), { status: 400 });
        }
        const stream = inForm.get("stream") === "true";

        const upstream = new FormData();
        const asFile = audio as File;
        if (asFile.size < 1024) return new Response(JSON.stringify({ error: "Audio is empty" }), { status: 400 });
        if (asFile.size > 25 * 1024 * 1024) return new Response(JSON.stringify({ error: "Audio is too large" }), { status: 413 });
        const mime = asFile.type || "audio/wav";
        if (!mime.startsWith("audio/")) return new Response(JSON.stringify({ error: "Unsupported audio type" }), { status: 400 });
        const name = asFile.name || "recording.wav";
        upstream.append("model", "openai/gpt-4o-transcribe");
        upstream.append("file", audio as Blob, name);
        upstream.append("language", "ar");
        upstream.append("temperature", "0");
        if (stream) upstream.append("stream", "true");
        upstream.append("prompt", "انسخ الكلام العربي المسموع حرفياً فقط كما قيل بلهجة سعودية أو مصرية عامية. المهمة تهجئة لوحات سعودية: 3 حروف ثم 4 أرقام. الحروف الرسمية فقط: أ ب ح د ر س ص ط ع ق ك ل م ن هـ و ي. كلمة (ألف/الف) داخل الحروف تعني حرف أ وليست الرقم 1000. الأرقام يفضل أن تُنسخ كأرقام منفردة إذا نُطقت منفردة: واحد تسعة تسعة صفر = 1990، اثنين صفر ثلاثة صفر = 2030، زيرو/صفر = 0. أمثلة: (ألف ألف نون واحد تسعة تسعة صفر)، (ألف باء جيم اثنين صفر ثلاثة صفر)، (عين لام لام عشرين تلاتين). لا تخترع لوحة، لا تكمل الناقص، لا تبدل ألف إلى ميم أو هاء، ولا تدمج لوحتين في جملة واحدة.");

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: upstream,
          });
          if (!res.ok) {
            const bodyText = await res.text().catch(() => "");
            console.error("STT gateway error", res.status, bodyText);
            return new Response(JSON.stringify({ error: bodyText || "Transcription failed", status: res.status }), { status: res.status });
          }
          if (stream) {
            return new Response(res.body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
          }
          const bodyText = await res.text();
          return new Response(bodyText, { headers: { "Content-Type": "application/json" } });
        } catch (err) {
          console.error(err);
          return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
        }
      },
    },
  },
});
