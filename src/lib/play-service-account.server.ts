/**
 * Robust parser for GOOGLE_PLAY_SERVICE_ACCOUNT_JSON.
 *
 * Users often paste the service-account JSON with the PEM private_key
 * containing real (unescaped) newlines, which is invalid JSON and blows up
 * `JSON.parse` with "Expected ',' or '}'" errors. This helper repairs the
 * common failure modes before parsing.
 */

export type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
  [k: string]: unknown;
};

function tryParse(raw: string): ServiceAccount | null {
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    return null;
  }
}

export function parseServiceAccount(rawInput: string): ServiceAccount {
  let raw = rawInput.trim();

  // 1) direct parse
  let sa = tryParse(raw);

  // 2) escape raw newlines/carriage returns inside the JSON text
  //    (service-account JSON has no meaningful raw newlines outside strings)
  if (!sa) {
    const fixed = raw.replace(/\r/g, "").replace(/\n/g, "\\n");
    sa = tryParse(fixed);
  }

  // 3) some users wrap the JSON in single quotes when pasting into forms
  if (!sa && raw.startsWith("'") && raw.endsWith("'")) {
    sa = tryParse(raw.slice(1, -1));
  }

  if (!sa) {
    throw new Error(
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full downloaded key file contents as-is.",
    );
  }

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Invalid service account JSON (missing client_email/private_key)");
  }
  return sa;
}

/** Normalize PEM: env vars often escape newlines as `\n` literals. */
export function normalizePem(pem: string): string {
  return pem.replace(/\\n/g, "\n");
}
