import { useState } from "react";
import { sound } from "@/lib/sound";

const EMOJIS = [
  "😂","🤣","😅","😍","🥰","😘","😎","🤩","🥳","😜","🤪","😏","😇","🤗","🤔","🙄",
  "😱","😭","😡","🤬","🥶","🥵","🤯","😴","🤤","🤠","🥸","🫡","🫶","🤝","👍","👎",
  "👏","🙌","💪","🫵","✌️","🤞","🤙","👋","🖐️","🙏","💯","🔥","⭐","✨","💫","⚡",
  "💥","💢","💦","💨","🎉","🎊","🎁","🏆","🥇","🥈","🥉","👑","💎","💰","💵","🪙",
  "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💖","💘","💝",
  "⚔️","🛡️","🏹","🗡️","🔫","💣","🧨","☠️","🏴‍☠️","⚓","🚢","⛴️","🛥️","⛵","🏝️","🌊",
  "🦈","🐉","🐲","🦅","🦁","🐯","🐺","🐗","🦂","🦑","🐙","🐠","🐟","🐳","🐋","🦀",
  "🌟","🌙","☀️","⛅","🌈","🍀","🌹","🌺","🎯","🎮","🃏","🎲","🍔","🍕","🍻","🥂",
];

export function QuickReplies({ onSend, disabled }: { onSend: (text: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { sound.play("click"); setOpen(o => !o); }}
        disabled={disabled}
        className="px-3 py-2 rounded-lg bg-stone-800 border border-amber-700/40 text-sm text-amber-200 disabled:opacity-50 active:scale-95"
        title="إيموجي"
      >
        😀
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-12 left-0 right-0 z-40 p-2 rounded-xl bg-stone-950/95 border-2 border-amber-500/60 shadow-2xl min-w-[300px] max-h-[320px] overflow-y-auto">
            <div className="grid grid-cols-8 gap-1">
              {EMOJIS.map((e, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { sound.play("click"); onSend(e); setOpen(false); }}
                  className="flex items-center justify-center p-2 rounded-lg bg-stone-800 hover:bg-amber-900/40 active:scale-95 text-2xl"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
