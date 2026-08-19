// Blocks off-platform contact solicitation in DMs (social apps, english
// usernames, handles, phone numbers) — even when decorated / obfuscated.
// Mirrors public.dm_contact_match() in the database (server is the source of truth).

const MATH_START = 0x1d400;
const MATH_END = 0x1d6a3;

function destyleLatin(input: string): string {
  let out = "";
  for (const ch of input) {
    const cp = ch.codePointAt(0)!;
    if (cp >= MATH_START && cp <= MATH_END) {
      const off = (cp - MATH_START) % 52;
      out += String.fromCharCode(97 + (off < 26 ? off : off - 26));
    } else if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
      out += String.fromCharCode(48 + ((cp - 0x1d7ce) % 10));
    } else if (cp >= 0xff21 && cp <= 0xff3a) out += String.fromCharCode(97 + cp - 0xff21);
    else if (cp >= 0xff41 && cp <= 0xff5a) out += String.fromCharCode(97 + cp - 0xff41);
    else if (cp >= 0xff10 && cp <= 0xff19) out += String.fromCharCode(48 + cp - 0xff10);
    else if (cp >= 0x24b6 && cp <= 0x24cf) out += String.fromCharCode(97 + cp - 0x24b6);
    else if (cp >= 0x24d0 && cp <= 0x24e9) out += String.fromCharCode(97 + cp - 0x24d0);
    else if (cp >= 0x1f130 && cp <= 0x1f149) out += String.fromCharCode(97 + cp - 0x1f130);
    else if (cp >= 0x1f150 && cp <= 0x1f169) out += String.fromCharCode(97 + cp - 0x1f150);
    else if (cp >= 0x1f170 && cp <= 0x1f189) out += String.fromCharCode(97 + cp - 0x1f170);
    else if (cp >= 0x1d00 && cp <= 0x1d2b) out += String.fromCharCode(97 + ((cp - 0x1d00) % 26));
    else out += ch;
  }
  return out;
}

function normalize(input: string): string {
  let s = destyleLatin(input).toLowerCase();
  s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "");
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  s = s.replace(/[إأآٱا]/g, "ا").replace(/[ىئي]/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و");
  s = s.replace(/[گک]/g, "ك").replace(/چ/g, "ج").replace(/پ/g, "ب").replace(/ڤ/g, "ف");
  s = s.replace(/[0134578@$!|]/g, (c) => "oieastasil"["0134578@$!|".indexOf(c)]);
  s = s.replace(/[^a-z0-9\u0621-\u064A]+/g, " ");
  s = s.replace(/(.)\1+/g, "$1");
  return s.replace(/\s+/g, " ").trim();
}

const AR = [
  "سناب","سنابي","سنابشات","تيكتوك","تكتوك","انستا","انستقرام","انستغرام","انستجرام",
  "واتس","واتساب","وتساب","تلجرام","تليجرام","تيليجرام","تلقرام","تلكرام",
  "دسكورد","ديسكورد","تويتر","فيسبوك","يوتيوب","سكايب","فايبر","ايمو","بيقو","لايكي",
  "يوزر","يوزري","ايدي","معرفي","حسابيفي","تابعني","اضفني","ضفني","جوالي","رقمي","واتسي","خارجاللعبه","برهاللعبه",
];
const EN = [
  "snap","snapchat","tiktok","instagram","insta","whatsapp","watsap","wtsp","telegram","discord",
  "twitter","facebook","youtube","skype","viber","imo","bigo","likee","signal","kik","messenger","zoom","wechat",
];
const SAFE = new Set([
  "hello","hala","halo","okay","good","nice","great","thanks","thank","please","welcome","sorry",
  "yes","love","king","game","play","best","well","cool","haha","bye","level","vip",
  "hamor","molok","deep","gold","gems","ship","fish","boss","team","club",
]);

/** Returns the matched term when the text tries to move contact outside the game. */
export function contactMatch(input: string): string | null {
  if (!input) return null;
  const raw = input.toLowerCase();
  if (/@[a-z0-9._-]{3,}/.test(raw)) return "handle";
  if (/(https?:\/\/|www\.|\.com|\.net|\.me|\.gg|t\.me)/.test(raw)) return "link";
  const digits = input.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^0-9]/g, "");
  if (digits.length >= 7) return "phone";

  const norm = normalize(input);
  const flat = norm.replace(/ /g, "");
  for (const w of AR) if (flat.includes(normalize(w))) return w;
  for (const w of EN) if (flat.includes(w)) return w;
  for (const tok of norm.split(" ")) {
    if (/^[a-z][a-z0-9]{3,}$/.test(tok) && !SAFE.has(tok)) return "username";
  }
  return null;
}

export const CONTACT_BLOCK_MESSAGE =
  "🚫 ممنوع مشاركة حسابات التواصل أو اليوزرات أو الأرقام في الخاص";

/** Shared normalizer (destyled, de-diacritized, letter-collapsed). */
export function normalizeArabicText(input: string): string {
  return normalize(input);
}
