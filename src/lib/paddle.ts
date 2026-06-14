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
 * Paddle only approved checkout on `hamor.lovable.app`. If the user is on
 * the new custom domain (e.g. molok-alqarasna.com) and tries to pay, we
 * redirect them to the approved host so the Paddle overlay loads correctly.
 *
 * Returns `true` when checkout may proceed on the current host, `false` when
 * a redirect has been triggered and the caller should abort.
 */
const APPROVED_PAYMENT_HOST = "hamor.lovable.app";

function isHostApprovedForPayment(host: string): boolean {
  if (!host) return true;
  if (host === APPROVED_PAYMENT_HOST) return true;
  // Allow local dev and Lovable preview/sandbox hosts (test mode).
  if (host === "localhost" || host.startsWith("127.0.0.1")) return true;
  if (host.endsWith(".lovable.app") || host.endsWith(".lovable.dev")) return true;
  if (host.endsWith(".lovableproject.com")) return true;
  return false;
}

export function ensurePaymentHost(): boolean {
  if (typeof window === "undefined") return true;
  const { hostname, pathname, search, hash } = window.location;
  if (isHostApprovedForPayment(hostname)) return true;
  const target = `https://${APPROVED_PAYMENT_HOST}${pathname}${search}${hash}`;
  window.location.replace(target);
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
