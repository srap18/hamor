// Sanitizes user-visible error toasts so they never leak internal details
// (file paths, function names, RPC/SQL/stack traces, URLs, English error
// jargon). Anything that looks technical is replaced by a generic Arabic
// message: "حدث خطأ، حاول مرة أخرى".
//
// This monkey-patches sonner's `toast.error` / `toast.warning` once on the
// client. Safe to import multiple times.

import { toast } from "sonner";

const GENERIC = "حدث خطأ، حاول مرة أخرى";

// Patterns that indicate a technical / internal-looking message.
const TECH_PATTERNS: RegExp[] = [
  /\//,                       // any path or URL slash
  /\\/,                       // windows paths / escapes
  /\bhttps?:/i,
  /\bsupabase\b/i,
  /\brpc\b/i,
  /\bpostgres/i,
  /\bsql\b/i,
  /\bjwt\b/i,
  /\bjson\b/i,
  /\bfunction\b/i,
  /\bstack\b/i,
  /\bundefined\b/i,
  /\bnull\b/i,
  /\bTypeError\b/,
  /\bReferenceError\b/,
  /\bSyntaxError\b/,
  /\bError:\s/,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\b40\d\b/,                 // HTTP 4xx
  /\b50\d\b/,                 // HTTP 5xx
  /\bcode\s*[:=]/i,
  /\bat\s+\w+\s*\(/,          // stack frames "at fn ("
  /[A-Za-z_]+\.[A-Za-z_]+/,   // foo.bar (function refs, file ext)
  /[a-z]+_[a-z]+/i,           // snake_case identifiers (rpc/fn names)
  /[{}<>]/,                   // JSON/HTML fragments
  /policy/i,
  /permission/i,
  /violates/i,
  /constraint/i,
  /relation/i,
  /column/i,
  /row-level/i,
];

function looksTechnical(msg: string): boolean {
  if (!msg) return true;
  // Mostly-ASCII (latin) text is almost certainly an English/system error.
  const asciiRatio =
    msg.replace(/[^\x20-\x7E]/g, "").length / Math.max(msg.length, 1);
  if (asciiRatio > 0.6) return true;
  return TECH_PATTERNS.some((re) => re.test(msg));
}

function sanitize(input: unknown): string {
  let msg = "";
  if (typeof input === "string") msg = input;
  else if (input instanceof Error) msg = input.message;
  else if (input && typeof input === "object") {
    const anyObj = input as Record<string, unknown>;
    msg = String(anyObj.message ?? "");
  }
  msg = msg.trim();
  if (!msg) return GENERIC;
  return looksTechnical(msg) ? GENERIC : msg;
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
