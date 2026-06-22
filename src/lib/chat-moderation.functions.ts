import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYS = `أنت مُصنّف صارم للسب والشتم في دردشة لعبة عربية. أجب فقط بصيغة JSON: {"safe": boolean, "reason": string}.
اعتبر الرسالة غير آمنة (safe=false) إذا احتوت على:
- ألفاظ جنسية صريحة بأي صيغة أو تحايل (مسافات/رموز/تكرار حروف) مثل: كس، زب، نيك، طيز، شرموطة، عاهرة، متناك، قحبة...
- سب الدين أو المقدسات أو لعن الدين/الذات الإلهية.
- لعن مباشر للأشخاص أو الأهل (يلعن أبوك/أمك/دينك...).
- شتائم بالحيوانات موجهة لشخص: كلب، حمار، خنزير، حيوان، تيس.
- أي شتيمة فاحشة موجهة للاعب آخر.

اعتبرها آمنة (safe=true) إذا كانت:
- كلام عادي أو تحدّي داخل اللعبة.
- كلمات خفيفة مثل: غبي، ضعيف، فاشل، مجنون، أهبل، جبان، خسيس، تافه.
- كلمات تحتوي حروف متشابهة بالصدفة لكنها ليست شتيمة (مثل: كسب، كسر، كاس، نيكولا، طيزة جغرافية... إلخ).
- ذكر الله بأدب (بسم الله، سبحان الله، الحمد لله، لا إله إلا الله).

لا تستنتج شتيمة من تركيب كلمات منفصلة. ركّز على الكلمات كما كُتبت بعد إزالة الرموز والتكرار. أعطِ reason قصيرًا بالعربية.`;

export const moderateChatText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { text: string }) => {
    if (!input?.text || typeof input.text !== "string") throw new Error("missing text");
    const t = input.text.slice(0, 500);
    return { text: t };
  })
  .handler(async ({ data }): Promise<{ safe: boolean; reason: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    // Fail open on infra error so chat keeps working; DB filter still runs.
    if (!apiKey) return { safe: true, reason: "" };
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [
            { role: "system", content: SYS },
            { role: "user", content: data.text },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        console.error("[chat-moderation] gateway", res.status);
        return { safe: true, reason: "" };
      }
      const json = await res.json();
      const txt: string = json?.choices?.[0]?.message?.content ?? "";
      const cleaned = txt.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return {
        safe: parsed.safe !== false,
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      };
    } catch (e) {
      console.error("[chat-moderation] error", e);
      return { safe: true, reason: "" };
    }
  });
