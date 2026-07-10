import { useState } from "react";

/**
 * Modal shown when a login/signup would consume a device slot for 14 days.
 * User must confirm before the slot is locked.
 */
export function SlotWarningModal(props: {
  freeSlots: number;
  lockDays: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70" dir="rtl">
      <div className="w-full max-w-sm rounded-2xl bg-stone-950 border-2 border-amber-600 p-5 text-white shadow-2xl">
        <div className="text-center text-4xl mb-2">⚠️</div>
        <div className="text-lg font-extrabold text-amber-300 text-center mb-3">
          هل أنت متأكد من تسجيل هذا الحساب على هذا الجهاز؟
        </div>
        <div className="text-sm text-amber-100/90 leading-6 space-y-2 mb-4">
          <p>• كل جهاز مسموح له بحسابين فقط.</p>
          <p>• سيتم قفل هذا الحساب على هذا الجهاز لمدة <b className="text-amber-300">{props.lockDays} يوم</b>.</p>
          <p>• لن تستطيع استبداله بحساب آخر إلا بعد انتهاء المدة.</p>
          <p>• الأماكن المتبقية على هذا الجهاز: <b>{props.freeSlots}</b></p>
        </div>
        <div className="flex gap-2">
          <button onClick={props.onCancel}
            className="flex-1 py-2 rounded-lg bg-stone-800 border border-stone-700 text-white text-sm font-bold active:scale-95">
            إلغاء
          </button>
          <button onClick={props.onConfirm}
            className="flex-1 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 border-2 border-amber-200 text-amber-950 text-sm font-extrabold active:scale-95">
            نعم، متأكد
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown when a device has 2 locked slots and the user tries a 3rd account.
 * Offers an appeal form.
 */
export function DeviceBlockedModal(props: {
  hardwareHash: string;
  hasPendingAppeal: boolean;
  cooldownUntil: string | null;
  onClose: () => void;
}) {
  const [msg, setMsg] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const cooldownActive = props.cooldownUntil && new Date(props.cooldownUntil).getTime() > Date.now();
  const cooldownText = cooldownActive
    ? `يمكنك تقديم طعن جديد بعد: ${new Date(props.cooldownUntil!).toLocaleDateString("ar")}`
    : null;

  const submit = async () => {
    if (msg.trim().length < 10) { setResult("الرسالة قصيرة جداً (على الأقل 10 أحرف)"); return; }
    setSending(true); setResult(null);
    try {
      const { deviceSubmitAppeal } = await import("@/lib/device-slots.functions");
      const r: any = await deviceSubmitAppeal({ data: { hardwareHash: props.hardwareHash, email, message: msg } });
      if (r?.ok) setResult("✅ تم إرسال طعنك. سيراجعه الأدمن قريباً.");
      else if (r?.error === "already_pending") setResult("لديك طعن قيد المراجعة بالفعل.");
      else if (r?.error === "cooldown") setResult("انتظر انتهاء فترة الحظر قبل تقديم طعن جديد.");
      else setResult("تعذّر الإرسال. حاول لاحقاً.");
    } catch { setResult("خطأ في الشبكة."); }
    finally { setSending(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-stone-950 border-2 border-red-600 p-5 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="text-center text-4xl mb-2">🚫</div>
        <div className="text-lg font-extrabold text-red-300 text-center mb-2">
          الجهاز ممتلئ
        </div>
        <div className="text-sm text-red-100/90 leading-6 mb-4 text-center">
          هذا الجهاز مربوط بحسابين مقفولين بالفعل. لا يمكن تسجيل الدخول بحساب ثالث حتى ينتهي القفل أو يوافق الأدمن على طعنك.
        </div>

        {props.hasPendingAppeal ? (
          <div className="p-3 rounded-lg bg-amber-900/40 border border-amber-700/50 text-center text-amber-100 text-sm">
            لديك طعن قيد المراجعة. سيتم الرد قريباً.
          </div>
        ) : cooldownActive ? (
          <div className="p-3 rounded-lg bg-stone-900/60 border border-stone-700 text-center text-stone-300 text-sm">
            {cooldownText}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-amber-200 font-bold">تقديم طعن للإدارة:</div>
            <input type="email" placeholder="بريدك الإلكتروني (اختياري)" value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 text-white text-sm" />
            <textarea placeholder="اشرح سبب طلبك بالتفصيل..." value={msg} onChange={(e) => setMsg(e.target.value)}
              rows={4} maxLength={2000}
              className="w-full px-3 py-2 rounded-lg bg-stone-900 border border-stone-700 text-white text-sm resize-none" />
            <button onClick={submit} disabled={sending}
              className="w-full py-2 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-sm font-extrabold active:scale-95 disabled:opacity-50">
              {sending ? "..." : "إرسال الطعن"}
            </button>
            {result && <div className="text-xs text-center text-amber-200 mt-1">{result}</div>}
          </div>
        )}

        <button onClick={props.onClose}
          className="w-full mt-4 py-2 rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm active:scale-95">
          إغلاق
        </button>
      </div>
    </div>
  );
}

/**
 * Legacy migration: device has >2 historical accounts. User picks 2 to keep.
 */
export function DeviceMigrationModal(props: {
  hardwareHash: string;
  candidates: Array<{ user_id: string; display_name: string; email: string }>;
  currentUserId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    props.candidates.some((c) => c.user_id === props.currentUserId) ? [props.currentUserId] : [],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (uid: string) => {
    setSelected((s) => {
      if (s.includes(uid)) return s.filter((x) => x !== uid);
      if (s.length >= 2) return s;
      return [...s, uid];
    });
  };

  const save = async () => {
    if (!selected.includes(props.currentUserId)) { setErr("يجب اختيار حسابك الحالي ضمن الحسابين."); return; }
    setSaving(true); setErr(null);
    try {
      const { deviceMigrateChoose } = await import("@/lib/device-slots.functions");
      const [a, b] = selected;
      const r: any = await deviceMigrateChoose({ data: { hardwareHash: props.hardwareHash, userA: a, userB: b || null } });
      if (r?.ok) props.onDone();
      else setErr("تعذّر الحفظ. حاول لاحقاً.");
    } catch { setErr("خطأ في الشبكة."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-stone-950 border-2 border-amber-600 p-5 text-white shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="text-center text-3xl mb-2">📱</div>
        <div className="text-lg font-extrabold text-amber-300 text-center mb-2">اختر حسابين فقط</div>
        <div className="text-xs text-amber-100/80 leading-5 mb-3 text-center">
          هذا الجهاز مربوط بأكثر من حسابين. اختر <b>حسابين فقط</b> لتربطهما بهذا الجهاز لمدة 14 يوم.
          بقية الحسابات لن تستطيع الدخول من هنا.
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto mb-3">
          {props.candidates.map((c) => {
            const on = selected.includes(c.user_id);
            const isCurrent = c.user_id === props.currentUserId;
            return (
              <button key={c.user_id} onClick={() => toggle(c.user_id)}
                className={`w-full text-right p-2.5 rounded-lg border-2 transition ${
                  on ? "bg-amber-600/30 border-amber-400" : "bg-stone-900 border-stone-700"
                }`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold">{c.display_name || c.email}</div>
                    <div className="text-[11px] text-stone-400">{c.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-700 text-emerald-100">الحالي</span>}
                    <div className={`w-5 h-5 rounded border-2 ${on ? "bg-amber-400 border-amber-200" : "border-stone-600"}`} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <div className="text-xs text-amber-200 text-center mb-2">تم اختيار {selected.length} من 2</div>
        {err && <div className="text-red-300 text-xs text-center mb-2">{err}</div>}
        <div className="flex gap-2">
          <button onClick={props.onCancel}
            className="flex-1 py-2 rounded-lg bg-stone-800 border border-stone-700 text-white text-sm font-bold active:scale-95">
            إلغاء
          </button>
          <button onClick={save} disabled={saving || selected.length === 0}
            className="flex-1 py-2 rounded-lg bg-gradient-to-b from-amber-400 to-amber-700 text-amber-950 text-sm font-extrabold active:scale-95 disabled:opacity-50">
            {saving ? "..." : "تأكيد الاختيار"}
          </button>
        </div>
      </div>
    </div>
  );
}
