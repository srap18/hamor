import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYS = "You are a strict image safety classifier. Reply ONLY with strict JSON: {\"safe\": boolean, \"category\": string, \"reason\": string}. Set safe=false if ANY image shows nudity, sexual or suggestive content, explicit lingerie/underwear, gore, graphic violence, hateful symbols, drugs, self-harm, or minors in inappropriate context. Otherwise safe=true.";

async function classify(images: { base64: string; mime: string }[]) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { safe: true, reason: "moderation_unavailable", category: "" };
  const content: any[] = [{ type: "text", text: "Classify these image(s). If ANY is unsafe, return safe=false." }];
  for (const im of images) {
    content.push({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.base64}` } });
  }
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-lite",
      messages: [{ role: "system", content: SYS }, { role: "user", content }],
      temperature: 0,
    }),
  });
  if (!res.ok) return { safe: true, reason: "moderation_error", category: "" };
  const json = await res.json();
  const txt: string = json?.choices?.[0]?.message?.content ?? "";
  try {
    const cleaned = txt.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      safe: !!parsed.safe,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      category: typeof parsed.category === "string" ? parsed.category : "",
    };
  } catch {
    return { safe: true, reason: "moderation_parse_error", category: "" };
  }
}

export const moderateImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { imageBase64: string; mimeType?: string }) => {
    if (!input?.imageBase64 || typeof input.imageBase64 !== "string") throw new Error("missing image");
    if (input.imageBase64.length > 8_000_000) throw new Error("image too large");
    return input;
  })
  .handler(async ({ data }) => {
    return classify([{ base64: data.imageBase64, mime: data.mimeType || "image/jpeg" }]);
  });

export const moderateFrames = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { framesBase64: string[]; mimeType?: string }) => {
    if (!Array.isArray(input?.framesBase64) || input.framesBase64.length === 0) throw new Error("missing frames");
    if (input.framesBase64.length > 6) throw new Error("too many frames");
    const total = input.framesBase64.reduce((s, f) => s + f.length, 0);
    if (total > 12_000_000) throw new Error("frames too large");
    return input;
  })
  .handler(async ({ data }) => {
    const mime = data.mimeType || "image/jpeg";
    return classify(data.framesBase64.map((b) => ({ base64: b, mime })));
  });
