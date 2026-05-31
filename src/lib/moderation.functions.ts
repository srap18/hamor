import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Classifies an image for NSFW / explicit / sexual / violent content using
 * Lovable AI (Gemini Vision). Returns { safe, reason } so the client can
 * reject the upload before persisting it.
 */
export const moderateImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { imageBase64: string; mimeType?: string }) => {
    if (!input?.imageBase64 || typeof input.imageBase64 !== "string") throw new Error("missing image");
    if (input.imageBase64.length > 8_000_000) throw new Error("image too large");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      // Fail open if AI is unavailable — do not block uploads on infra outage.
      return { safe: true, reason: "moderation_unavailable" };
    }
    const mime = data.mimeType || "image/jpeg";
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "You are an image safety classifier. Reply ONLY with strict JSON: {\"safe\": boolean, \"category\": string, \"reason\": string}. Set safe=false if the image contains nudity, sexual content, pornography, explicit underwear/lingerie, gore, graphic violence, hateful symbols, or self-harm. Otherwise safe=true.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify this image." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${data.imageBase64}` } },
            ],
          },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      return { safe: true, reason: "moderation_error" };
    }
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
      return { safe: true, reason: "moderation_parse_error" };
    }
  });
