import { createFileRoute } from "@tanstack/react-router";

// Transcribe an uploaded audio blob using Lovable AI Gateway (openai/gpt-4o-transcribe).
// Requires Authorization: Bearer <supabase access token> so we can attribute the call.
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

        const inForm = await request.formData();
        const audio = inForm.get("audio");
        if (!audio || typeof audio === "string") {
          return new Response(JSON.stringify({ error: "No audio" }), { status: 400 });
        }


        const upstream = new FormData();
        const asFile = audio as File;
        const name = asFile.name || "recording.wav";
        upstream.append("model", "openai/gpt-4o-transcribe");
        upstream.append("file", audio as Blob, name);
        upstream.append("language", "ar");
        upstream.append("temperature", "0");
        // Neutral prompt: no example plates (they cause the model to echo phantom plates).
        upstream.append("prompt", "نطق حروف عربية منفصلة ثم أرقام. اكتب فقط ما يُنطق فعلاً بدون إضافة أي كلمات أو أمثلة، وإن لم يوجد صوت واضح فلا تكتب شيئاً.");

        try {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: upstream,
          });
          const bodyText = await res.text();
          if (!res.ok) {
            console.error("STT gateway error", res.status, bodyText);
            return new Response(JSON.stringify({ error: bodyText || "Transcription failed", status: res.status }), { status: res.status });
          }
          return new Response(bodyText, { headers: { "Content-Type": "application/json" } });

        } catch (err) {
          console.error(err);
          return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
        }
      },
    },
  },
});
