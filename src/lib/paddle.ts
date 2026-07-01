import { resolvePaddlePrice } from "@/utils/payments.functions";

const clientToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

declare global {
  interface Window {
    Paddle: any;
  }
}

export function getPaddleEnvironment(): "sandbox" | "live" {
  return clientToken?.startsWith("test_") ? "sandbox" : "live";
}

/**
 * كل الدومينات الرسمية للعبة (hamor.lovable.app و molok-alqarasna.com)
 * مسموح فيها الدفع. لا نحوّل المستخدم بين الدومينات لأن الجلسة لا تنتقل
 * تلقائياً ولأن الدومين الأساسي في Lovable يعيد التحويل ويحدث Loop.
 *
 * مهم: أضف الدومين `molok-alqarasna.com` في Paddle Dashboard →
 * Checkout Settings → Approved Domains حتى يفتح overlay الدفع.
 */
export function ensurePaymentHost(): boolean {
  return true;
}



let paddleInitialized = false;

type CheckoutListener = (event: { name: string; data?: any }) => void;
const listeners = new Set<CheckoutListener>();

export function onPaddleEvent(cb: CheckoutListener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export async function initializePaddle() {
  if (paddleInitialized) return;
  if (!clientToken) throw new Error("VITE_PAYMENTS_CLIENT_TOKEN is not set");

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-paddle="v2"]');
    const setup = () => {
      try {
        const paddleJsEnvironment = getPaddleEnvironment() === "sandbox" ? "sandbox" : "production";
        window.Paddle.Environment.set(paddleJsEnvironment);
        window.Paddle.Initialize({
          token: clientToken,
          checkout: {
            settings: {
              displayMode: "overlay",
              theme: "dark",
              locale: "ar",
              allowLogout: false,
            },
          },
          eventCallback: (event: any) => {
            const name = event?.name ?? "";
            // eslint-disable-next-line no-console
            console.log("[Paddle]", name, event?.code ?? "", event?.detail ?? "");
            if (typeof document !== "undefined") {
              if (name === "checkout.loaded" || name === "checkout.opened") {
                document.body.classList.add("paddle-checkout-open");
              }
              if (
                name === "checkout.closed" ||
                name === "checkout.completed" ||
                name === "checkout.error" ||
                name === "checkout.payment.failed"
              ) {
                document.body.classList.remove("paddle-checkout-open");
              }
            }
            listeners.forEach((l) => {
              try { l(event); } catch { /* noop */ }
            });
          },
        });
        paddleInitialized = true;
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    if (existing && window.Paddle) return setup();
    const script = existing ?? document.createElement("script");
    if (!existing) {
      script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
      script.dataset.paddle = "v2";
      document.head.appendChild(script);
    }
    script.onload = setup;
    script.onerror = () => reject(new Error("Failed to load Paddle.js"));
  });
}

/**
 * Client-side override map: offer external_id → Paddle price id (pri_...).
 * Paddle لا يسمح بتعديل import_meta.external_id عبر API، لذلك نربط يدوياً.
 * أضف أي عرض جديد هنا بعد إنشائه في Paddle.
 */
const PRICE_ID_OVERRIDES: Record<string, string> = {
  offer_nuke_mega_200: "pri_01kwem50yhvy488prrt60900a3",
  offer_ad_bomb_mega_200: "pri_01kwemesq1pntz33g3a7r49rk7",
  offer_shield_15d_bonus: "pri_01kwemh0ttbj52z8gajfb55d93",
  offer_anti_all_10: "pri_01kwemmhs85mgkew22ry8gnzbw",
  offer_disabler_all_10: "pri_01kwemqsy9rky91k00ss8mtgse",
};

export async function getPaddlePriceId(priceId: string): Promise<string> {
  if (priceId.startsWith("pri_")) return priceId;
  const override = PRICE_ID_OVERRIDES[priceId];
  if (override) return override;
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}

