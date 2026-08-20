import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import {
  listAccounts,
  rememberSession,
  refreshAccountMeta,
  removeAccount,
  switchToAccount,
  beginAddAccount,
  MAX_ACCOUNTS,
  type StoredAccount,
} from "@/lib/account-switch";
import { sound } from "@/lib/sound";

export function AccountSwitcher({ onClose }: { onClose?: () => void }) {
  const nav = useNavigate();
  const [accounts, setAccounts] = useState<StoredAccount[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(() => setAccounts(listAccounts()), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) {
        rememberSession(data.session);
        setCurrentId(data.session.user.id);
        if (!listAccounts().find((a) => a.userId === data.session!.user.id)?.username) {
          await refreshAccountMeta(data.session.user.id);
        }
      }
      reload();
    })();
    const onChange = () => reload();
    window.addEventListener("accounts:changed", onChange);
    return () => {
      alive = false;
      window.removeEventListener("accounts:changed", onChange);
    };
  }, [reload]);

  const doSwitch = async (id: string) => {
    if (busy || id === currentId) return;
    sound.play("click");
    setBusy(id);
    setMsg(null);
    const res = await switchToAccount(id);
    if (res.ok) {
      // Hard reload guarantees no data from the previous account stays in memory/cache.
      window.location.replace("/");
      return;
    }
    setBusy(null);
    reload();
    setMsg(res.reason);
  };

  const addAccount = async () => {
    if (busy) return;
    sound.play("click");
    setBusy("add");
    await beginAddAccount();
    onClose?.();
    // A full navigation is required because /login intentionally permits the
    // still-active origin session only while add-account mode is pending.
    window.location.assign("/login");
  };

  const forget = (id: string) => {
    if (id === currentId) return;
    removeAccount(id);
    reload();
  };

  const others = accounts.filter((a) => a.userId !== currentId);
  const canAdd = accounts.length < MAX_ACCOUNTS || others.length === 0;

  return (
    <div className="mb-4 p-3 rounded-lg bg-black/30 border border-accent/30" dir="rtl">
      <div className="text-xs text-accent/80 mb-2">الحسابات (حسابان كحد أقصى لكل جهاز)</div>

      <div className="space-y-2">
        {accounts.map((a) => {
          const active = a.userId === currentId;
          return (
            <div
              key={a.userId}
              className={`flex items-center gap-2 p-2 rounded-lg border ${active ? "border-emerald-500/70 bg-emerald-900/20" : "border-accent/25 bg-black/25"}`}
            >
              <div className="text-lg shrink-0">{a.emoji || "🏴‍☠️"}</div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">
                  {a.username || a.email || "حساب"}
                </div>
                <div className="text-[10px] text-accent/60 truncate">{a.email || ""}</div>
              </div>
              {active ? (
                <span className="text-[10px] font-bold text-emerald-300 shrink-0">
                  الحساب الحالي
                </span>
              ) : (
                <>
                  <button
                    onClick={() => doSwitch(a.userId)}
                    disabled={!!busy}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-b from-amber-500 to-amber-700 text-white text-[11px] font-bold active:scale-95 disabled:opacity-50 shrink-0"
                  >
                    {busy === a.userId ? "..." : "تبديل"}
                  </button>
                  <button
                    onClick={() => forget(a.userId)}
                    disabled={!!busy}
                    className="px-2 py-1.5 rounded-lg bg-black/40 border border-rose-700/50 text-rose-300 text-[11px] font-bold active:scale-95 disabled:opacity-50 shrink-0"
                    title="إزالة من القائمة"
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      {canAdd && (
        <button
          onClick={addAccount}
          disabled={!!busy}
          className="w-full mt-2 py-2 rounded-lg bg-gradient-to-b from-sky-600 to-sky-800 text-white text-xs font-bold active:scale-95 disabled:opacity-50"
        >
          ＋ إضافة حساب آخر
        </button>
      )}
      {!canAdd && (
        <div className="mt-2 text-[10px] text-accent/60 leading-snug">
          وصلت للحد الأقصى (حسابان). احذف حسابًا من القائمة لإضافة غيره.
        </div>
      )}
      {msg && <div className="mt-2 text-[11px] text-rose-300 leading-snug">{msg}</div>}
      <div className="mt-2 text-[10px] text-accent/50 leading-snug">
        التبديل لا يحفظ كلمات المرور، ويعيد فحص الحظر وخانات الجهاز في كل مرة.
      </div>
    </div>
  );
}
