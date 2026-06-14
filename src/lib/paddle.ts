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
 * Paddle لم يعتمد الدومين الجديد (molok-alqarasna.com) بعد.
 * نحوّل المستخدم تلقائياً لدومين Lovable المعتمد قبل فتح صفحة الدفع
 * حتى يقبل Paddle الدومين الجديد رسمياً.
 */
const PAYMENT_APPROVED_HOST = "hamor.lovable.app";
const PAYMENT_BLOCKED_HOSTS = ["molok-alqarasna.com", "www.molok-alqarasna.com"];

export function ensurePaymentHost(): boolean {
  if (typeof window === "undefined") return true;
  const host = window.location.hostname;
  if (!PAYMENT_BLOCKED_HOSTS.includes(host)) return true;
  const url = `https://${PAYMENT_APPROVED_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(url);
  return false;
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
          eventCallback: (event: any) => {
            const name = event?.name ?? "";
            // eslint-disable-next-line no-console
            console.log("[Paddle]", name);
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

export async function getPaddlePriceId(priceId: string): Promise<string> {
  return resolvePaddlePrice({ data: { priceId, environment: getPaddleEnvironment() } });
}
