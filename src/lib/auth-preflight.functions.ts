import { createServerFn } from "@tanstack/react-start";

// Curated list of widely-known disposable / temp-mail providers.
// Kept inline so we don't depend on any external service.
const DISPOSABLE_DOMAINS = new Set<string>([
  "10minutemail.com","10minutemail.net","20minutemail.com","temp-mail.org","tempmail.com","tempmail.dev",
  "tempmailo.com","tempmail.plus","tmpmail.org","tmpmail.net","tmpeml.com","tmail.ws","tmails.net",
  "tmpmail.io","disposablemail.com","throwawaymail.com","mailinator.com","mailinator.net","mailinator.org",
  "mailnesia.com","maildrop.cc","guerrillamail.com","guerrillamail.net","guerrillamail.org","guerrillamail.biz",
  "guerrillamailblock.com","sharklasers.com","grr.la","spam4.me","yopmail.com","yopmail.fr","yopmail.net",
  "trashmail.com","trashmail.de","trashmail.io","trashmail.net","trashmail.ws","getnada.com","nada.email",
  "fakeinbox.com","fakemailgenerator.com","mohmal.com","dropmail.me","mintemail.com","minuteinbox.com",
  "emailondeck.com","mytemp.email","my10minutemail.com","instantemailaddress.com","mailcatch.com",
  "mailpoof.com","spambox.us","spambog.com","spambog.de","spambog.ru","spamgourmet.com","mailtemp.info",
  "tempinbox.com","tempinbox.co.uk","temp-mail.io","temp-mail.us","tmpbox.net","tmpemail.net","tempr.email",
  "discard.email","discardmail.com","discardmail.de","emkei.cz","mvrht.net","mvrht.com","binkmail.com",
  "bouncr.com","cool.fr.nf","courriel.fr.nf","jetable.fr.nf","mail-temporaire.fr","monemail.fr.nf",
  "mailtothis.com","mt2014.com","mt2015.com","mytrashmail.com","nepwk.com","no-spam.ws","nospam4.us",
  "nospamfor.us","nowmymail.com","objectmail.com","obobbo.com","oopi.org","ordinaryamerican.net",
  "owlpic.com","pookmail.com","privacy.net","proxymail.eu","quickinbox.com","rcpt.at","reallymymail.com",
  "rmqkr.net","rppkn.com","safe-mail.net","selfdestructingmail.com","shieldedmail.com","shitmail.me",
  "skeefmail.com","slopsbox.com","smashmail.de","snakemail.com","sneakemail.com","sofort-mail.de",
  "spambob.com","spambob.net","spamcero.com","spamcorptastic.com","spamday.com","spamfree24.com",
  "spamfree24.de","spamfree24.eu","spamfree24.info","spamfree24.net","spamfree24.org","spamhole.com",
  "spamify.com","spaminator.de","spamkill.info","spaml.com","spaml.de","spamspot.com","spamthis.co.uk",
  "spamthisplease.com","spamtroll.net","tempemail.biz","tempemail.com","tempemail.net","tempinbox.co.uk",
  "tempmaildemand.com","tempmaili.com","tempmailtor.com","temporarily.de","temporarioemail.com.br",
  "temporaryemail.net","temporaryinbox.com","tempymail.com","throwam.com","throwawayemailaddress.com",
  "trbvm.com","wegwerfadresse.de","wegwerfemail.de","wh4f.org","wuzup.net","yourdomain.com","zoemail.net",
  "zippymail.info","zippymail.in","mvrht.net","mailsac.com","etranquil.com","etranquil.net","etranquil.org",
  "smailpro.com","tempr.email","tempm.com","emltmp.com","mailto.plus","fexpost.com","fextemp.com",
  "rover.info","inboxbear.com","fakermail.com","mail-temp.com","temporary-mail.net","tempemails.io",
  "edu.sg.io","spamok.com","onetimeemail.net","linshiyou.com","fnmail.com","tempmailaddress.com",
  "throwawayemail.com","tempmail.email","temporarymailaddress.com","incognitomail.com","incognitomail.net",
  "incognitomail.org","inbox.lv","kasmail.com","koszmail.pl","loadby.us","mail-filter.com",
  "mailbidon.com","mailblocks.com","mailbucket.org","mailfreeonline.com","mailhz.me","mailimate.com",
  "mailinatorzz.mooo.com","mailmoat.com","mailnator.com","mailnull.com","mailshell.com","mailsiphon.com",
  "mailslapping.com","mailslite.com","mailtothis.com","mailzilla.com","mailzilla.org","makemetheking.com",
  "mbx.cc","mega.zik.dj","mintemail.com","mjukglass.nu","mobi.web.id","moburl.com","mt2009.com",
  "mt2014.com","mycard.net.ua","myemailboxy.com","mymailoasis.com","mypartyclip.de","myphantomemail.com",
  "myspaceinc.com","myspaceinc.net","myspaceinc.org","myspacepimpedup.com","mytempemail.com",
  "no-spam.ws","noclickemail.com","nogmailspam.info","nomail.xl.cx","nomail2me.com","nomorespamemails.com",
  "nospam.ze.tc","nospammail.net","notmailinator.com","nowhere.org","nowmymail.com","ny7.me",
  "objectmail.com","oneoffemail.com","onewaymail.com","onlatedotcom.info","opayq.com","ordinaryamerican.net",
]);

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Public preflight check for signup / login.
 * Returns { blocked, reason } based on:
 *  - banned_emails (email)
 *  - banned_devices (device fingerprint from client)
 *  - disposable / temporary email domains (blocks fake mailboxes at signup)
 *
 * NOTE: IP-based blocking is intentionally removed. Bans apply only to the
 * specific device fingerprint and the user account, not to the connection.
 */
export const authPreflight = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: string | null; deviceId?: string | null }) => ({
    email: (input?.email ?? "").trim().toLowerCase().slice(0, 255) || null,
    deviceId: (input?.deviceId ?? "").trim().slice(0, 160) || null,
  }))
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );

    // Disposable email domain block (signup/login)
    if (data.email) {
      const dom = emailDomain(data.email);
      if (!dom || !dom.includes(".")) {
        return { blocked: true, reason: "صيغة البريد الإلكتروني غير صحيحة" };
      }
      if (DISPOSABLE_DOMAINS.has(dom)) {
        return { blocked: true, reason: "البريد المؤقت/الوهمي غير مسموح. استخدم بريداً حقيقياً (Gmail، Outlook، iCloud…)" };
      }
    }

    // Email
    if (data.email) {
      const { data: row } = await sb.from("banned_emails").select("email").eq("email", data.email).maybeSingle();
      if (row) return { blocked: true, reason: "هذا البريد محظور من إنشاء حساب أو الدخول" };
    }
    // Device fingerprint
    if (data.deviceId) {
      const { data: row } = await sb.from("banned_devices").select("device_id").eq("device_id", data.deviceId).maybeSingle();
      if (row) return { blocked: true, reason: "هذا الجهاز محظور — لا يمكن إنشاء أو دخول حساب منه" };
    }
    return { blocked: false, reason: null };
  });
