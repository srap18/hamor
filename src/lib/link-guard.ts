// Detects URLs and obfuscated links (with spaces, "dot"/"نقطة", zero-width chars).
// Used to block link sharing in chat and DMs.

const TLDS = [
  "com","net","org","io","co","me","tv","app","dev","gg","ly","xyz","info","biz",
  "us","uk","sa","ae","eg","kw","qa","om","bh","jo","sy","iq","ye","ma","tn","dz","ru","de","fr","es","it","tr","ir","in","cn","jp","kr","br","mx","ca","au","nl","se","no","fi","ch","pl","gr","pt","cz","be","at","dk","ie","nz","za","sg","hk","tw","th","my","id","ph","vn","pk","bd","lk","ar","cl","pe","ve","ro","hu","sk","ua","by","kz","uz","az","ge","am","il","lb","ng","ke","gh","et","ai","ml","online","store","shop","site","website","link","click","page","pro","tech","cloud","tube","stream","live","game","games","fun","wtf","cc","to","sh","is","im","fm","ws","vip","one","top","red","blue","mobi","name","tel","asia","art","best","blog","buzz","cam","chat","city","club","ee","email","fit","fyi","host","icu","ink","life","ltd","media","menu","money","plus","press","run","space","studio","style","today","trade","video","wiki","work","world","zone","group","help","kim","land","life","love","luxe","mom","new","news","party","pet","photo","photography","pics","pink","plumbing","poker","porn","racing","review","sex","sexy","social","software","solutions","support","tax","team","tips","tours","town","training","travel","university","vacations","ventures","watch","wedding","wine","xxx","yoga","zip","mov","gle","goog"
];

function normalize(input: string): string {
  let s = input.toLowerCase();
  // Strip zero-width / direction marks
  s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "");
  // Common obfuscations
  s = s.replace(/\(dot\)|\[dot\]|\{dot\}|\sdot\s|نقطه|نقطة|\.|·|・|｡|。/g, ".");
  s = s.replace(/\(at\)|\[at\]|\{at\}|\sat\s|@/g, "@");
  s = s.replace(/\(slash\)|\[slash\]|\\|\//g, "/");
  // Remove all whitespace and common separators between characters
  s = s.replace(/[\s\-_*'"`~|]+/g, "");
  return s;
}

export function containsLink(input: string): boolean {
  if (!input) return false;
  const original = input.toLowerCase();
  // Quick obvious checks on original
  if (/\bhttps?:\/\//i.test(original)) return true;
  if (/\bwww\./i.test(original)) return true;
  if (/\b[a-z0-9-]{2,}\.(?:com|net|org|io|co|me|tv|app|dev|gg|ly|xyz|info|sa|ae|ru|de|fr|uk|to|cc|link|click|live|online|shop|site|store)\b/i.test(original)) return true;
  if (/\bt\.me\/|\bbit\.ly|\btinyurl|\bwa\.me|\bdiscord\.gg|\bfb\.com|\binstagr|\btiktok|\byoutu\.?be|\btwitch\.tv|\btelegram\.me/i.test(original)) return true;

  // Normalized check (handles spaced/obfuscated)
  const n = normalize(input);
  if (/https?:\/\//.test(n)) return true;
  if (/www\.[a-z0-9]/.test(n)) return true;
  // domain.tld pattern in normalized text
  const tldGroup = TLDS.join("|");
  const re = new RegExp(`[a-z0-9]{2,}\\.(?:${tldGroup})(?:[\\/?#]|$|[^a-z])`, "i");
  if (re.test(n + " ")) return true;
  // ip address
  if (/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(n)) return true;
  return false;
}

export const LINK_BLOCK_MESSAGE = "🚫 ممنوع إرسال الروابط في الشات";
