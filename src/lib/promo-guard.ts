// Blocks outside-game promotion / rival-game wording in every chat surface
// (public, tribe, DM) — even when decorated, spaced, or split letter-by-letter.
// Mirrors public.chat_promo_match() in the database (server is the source of truth).

import { normalizeArabicText } from "./contact-guard";

const SINGLE = [
  "ملوك", "اعماق", "الاعماق", "قوقل", "جوجل", "google", "بلايستور", "بلاستور",
  "playstore", "googleplay", "appstore", "ابستور", "ايستور",
  "متجرقوقل", "متجرجوجل", "متجربلاي",
];

const PAIRS: [string, string][] = [
  ["اكتب", "متجر"], ["اكتب", "ستور"], ["اكتب", "بحث"], ["اكتب", "لعبه"],
  ["ابحث", "متجر"], ["ابحث", "ستور"], ["ابحث", "لعبه"],
  ["دور", "متجر"], ["دور", "لعبه"],
  ["حمل", "لعبه"], ["حمل", "متجر"], ["حمل", "ستور"],
  ["نزل", "لعبه"], ["نزل", "متجر"], ["نزل", "ستور"],
  ["لعبه", "جديده"], ["العبه", "جديده"], ["تعال", "لعبه"],
  ["سرش", "متجر"], ["search", "store"],
];

const flatten = (s: string) => normalizeArabicText(s).replace(/ /g, "");

/** Returns the matched forbidden term, or null when the text is fine. */
export function promoMatch(input: string): string | null {
  if (!input) return null;
  let flat = flatten(input);
  if (!flat) return null;
  // Our own game name stays allowed.
  flat = flat.replace(/ملوكالقراصنه/g, "").replace(/ملوكالقرصان/g, "");

  for (const t of SINGLE) if (flat.includes(flatten(t))) return t;
  for (const [a, b] of PAIRS) {
    if (flat.includes(flatten(a)) && flat.includes(flatten(b))) return `${a} ${b}`;
  }
  return null;
}
