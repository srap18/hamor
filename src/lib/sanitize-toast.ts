// Sanitizes user-visible error toasts so they never leak internal details
// (stack traces, SQL errors, JS exceptions). Anything that clearly looks
// like a raw JS/HTTP/SQL error is replaced by a generic Arabic message:
// "حدث خطأ، حاول مرة أخرى".
//
// Important: this MUST NOT mangle real notifications/messages that happen
// to contain latin characters (player names like "SAIF") or numbers
// (level 405, etc.). We therefore only sanitize when the input is an
// Error instance, OR when the string matches very specific raw-error
// signatures.

import { toast } from "sonner";

const GENERIC = "حدث خطأ، حاول مرة أخرى";

// Hard signals of a raw JS / Postgres / HTTP error leaking through.
const HARD_TECH_PATTERNS: RegExp[] = [
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bRangeError\b/,
  /\bError:\s/,
  /\bat\s+\w+\s*\([^)]*\)/,     // stack frame "at fn (file:line)"
  /\bstack trace\b/i,
  /\bundefined is not\b/i,
  /\bnull is not\b/i,
  /\bcannot read propert/i,
  /\brow-level security\b/i,
  /\bviolates .*constraint\b/i,
  /\bpermission denied for\b/i,
  /\bpostgres(?:ql)?\b/i,
  /\bJWT\b/,
  /\bsupabase\b/i,
  /https?:\/\//i,
  /\.(?:tsx?|jsx?|css|json)\b/i, // file extensions in message
];

function looksTechnical(msg: string): boolean {
  if (!msg) return false;
  return HARD_TECH_PATTERNS.some((re) => re.test(msg));
}

function sanitize(input: unknown): string {
  // Plain strings: pass through unless they clearly look like a raw error.
  if (typeof input === "string") {
    const msg = input.trim();
    if (!msg) return GENERIC;
    return looksTechnical(msg) ? GENERIC : msg;
  }

  // Error instances: almost always raw JS errors → generic message,
  // unless the message is short Arabic text deliberately thrown by us.
  if (input instanceof Error) {
    const msg = (input.message || "").trim();
    if (!msg) return GENERIC;
    if (looksTechnical(msg)) return GENERIC;
    // If the Error message is mostly ASCII (English), treat as technical.
    const ascii = msg.replace(/[^\x20-\x7E]/g, "").length;
    if (ascii / Math.max(msg.length, 1) > 0.7) return GENERIC;
    return msg;
  }

  // Objects with a message field.
  if (input && typeof input === "object") {
    const m = String((input as Record<string, unknown>).message ?? "").trim();
    if (!m) return GENERIC;
    return looksTechnical(m) ? GENERIC : m;
  }

  return GENERIC;
}

let installed = false;
export function installToastSanitizer() {
  if (installed) return;
  installed = true;
  try {
    const t = toast as unknown as Record<string, any>;
    const origError = t.error?.bind(toast);
    const origWarning = t.warning?.bind(toast);

    if (origError) {
      t.error = (msg: unknown, opts?: any) => origError(sanitize(msg), opts);
    }
    if (origWarning) {
      t.warning = (msg: unknown, opts?: any) => origWarning(sanitize(msg), opts);
    }
  } catch {
    // best-effort; never throw from sanitizer install
  }
}
