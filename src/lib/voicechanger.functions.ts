import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type PresetCfg = {
  voiceId: string;
  settings: { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean };
};

// ElevenLabs preset voice IDs (curated diverse set)
// "*_nat" = إعدادات طبيعية واقعية (ثبات أعلى + ستايل أقل = أقرب لصوت بشر حقيقي)
const PRESETS: Record<string, PresetCfg> = {
  girl:       { voiceId: "EXAVITQu4vr4xnSDxMaL", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  woman:      { voiceId: "XrExE9yKIg1WjnnlVkGX", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  man:        { voiceId: "JBFqnCBsd6RMkjVDRZzb", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  guy:        { voiceId: "TX3LPaxmHKxFdv7VOQHJ", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  kid:        { voiceId: "cgSgspJ2msm6clMCkdW9", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  santa:      { voiceId: "MDLAMJ0jxkpYkjXbmG4t", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },
  elf:        { voiceId: "e79twtVS2278lVZZQiAD", settings: { stability: 0.5,  similarity_boost: 0.85, style: 0.2, use_speaker_boost: true } },

  // أصوات طبيعية واقعية — تخفي هوية المتحدث وتبدو كإنسان حقيقي
  girl_nat:   { voiceId: "EXAVITQu4vr4xnSDxMaL", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Sarah
  woman_nat:  { voiceId: "Xb7hH8MSUJpSbSDYk0k2", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Alice
  laura_nat:  { voiceId: "FGY2WhTYpPnrIDTdsKH5", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Laura
  man_nat:    { voiceId: "onwK4e9ZLuTAKqWW03F9", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Daniel
  guy_nat:    { voiceId: "iP95p4xoKVk53GoZ742B", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Chris
  brian_nat:  { voiceId: "nPczCjzI2devNBz1zQrb", settings: { stability: 0.75, similarity_boost: 0.95, style: 0.05, use_speaker_boost: true } }, // Brian
};

export const transformVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { audioB64: string; preset: string; mimeType?: string }) => {
    if (!input?.audioB64 || typeof input.audioB64 !== "string") throw new Error("missing audio");
    if (input.audioB64.length > 4_000_000) throw new Error("audio too large"); // ~3MB
    if (!input?.preset || !PRESETS[input.preset]) throw new Error("invalid preset");
    return input;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("voice_unavailable: المفتاح غير مهيّأ");

    const cfg = PRESETS[data.preset];
    const bin = Buffer.from(data.audioB64, "base64");
    const blob = new Blob([new Uint8Array(bin)], { type: data.mimeType || "audio/webm" });

    const form = new FormData();
    form.append("audio", blob, "input.webm");
    form.append("model_id", "eleven_multilingual_sts_v2");
    form.append("remove_background_noise", "true");
    form.append("voice_settings", JSON.stringify(cfg.settings));

    let res: Response;
    try {
      res = await fetch(
        `https://api.elevenlabs.io/v1/speech-to-speech/${cfg.voiceId}?output_format=mp3_44100_128`,
        { method: "POST", headers: { "xi-api-key": apiKey }, body: form }
      );
    } catch {
      throw new Error("voice_network: تعذّر الاتصال بخدمة الصوت");
    }

    if (!res.ok) {
      const txt = (await res.text().catch(() => "")).toLowerCase();
      if (res.status === 401 || res.status === 403) {
        throw new Error("voice_auth: مفتاح ElevenLabs غير صالح");
      }
      if (res.status === 429 || txt.includes("quota") || txt.includes("credit") || txt.includes("exceed")) {
        throw new Error("voice_quota: انتهى رصيد ElevenLabs");
      }
      if (res.status >= 500) {
        throw new Error("voice_server: خدمة الصوت غير متاحة مؤقتاً");
      }
      throw new Error(`voice_error: ${res.status}`);
    }
    const out = await res.arrayBuffer();
    const outB64 = Buffer.from(out).toString("base64");
    return { audioB64: outB64, mimeType: "audio/mpeg" };
  });
