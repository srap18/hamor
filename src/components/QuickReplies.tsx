import { useState } from "react";
import { sound } from "@/lib/sound";

const PRESETS = [
  { id: "attack", emoji: "⚔️", text: "هجوم!" },
  { id: "retreat", emoji: "🏳️", text: "تراجع!" },
  { id: "wow", emoji: "🎉", text: "أحسنت!" },
  { id: "hi", emoji: "👋", text: "مرحى!" },
  { id: "ready", emoji: "🛡️", text: "تأهب!" },
  { id: "defend", emoji: "🚨", text: "احم نفسك!" },
  { id: "gg", emoji: "🤝", text: "لعبه جميله" },
  { id: "lol", emoji: "😂", text: "هههه" },
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
        title="ردود سريعه"
      >
        😀
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute bottom-12 left-0 right-0 z-40 grid grid-cols-4 gap-1 p-2 rounded-xl bg-stone-950/95 border-2 border-amber-500/60 shadow-2xl min-w-[280px]">
            {PRESETS.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { sound.play("click"); onSend(`${p.emoji} ${p.text}`); setOpen(false); }}
                className="flex flex-col items-center gap-0.5 p-2 rounded-lg bg-stone-800 hover:bg-amber-900/40 active:scale-95"
              >
                <span className="text-xl">{p.emoji}</span>
                <span className="text-[10px] text-amber-200 font-bold">{p.text}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
