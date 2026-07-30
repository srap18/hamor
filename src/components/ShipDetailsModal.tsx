import { createPortal } from "react-dom";
import { FISH } from "@/lib/fish";
import { getShipByCode, getShipByMarketLevel, type ShipDef } from "@/lib/ships";

const RARITY_AR: Record<string, string> = {
  Starter: "مبتدئ",
  Common: "عادية",
  Uncommon: "غير شائعة",
  Rare: "نادرة",
  Epic: "ملحمية",
  "Epic+": "ملحمية+",
  Legendary: "أسطورية",
  Mythic: "خرافية",
};

function fmt(n: number) {
  return Math.round(n).toLocaleString("en-US");
}

function duration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}س ${m}د`;
  if (m > 0) return `${m}د${s ? ` ${s}ث` : ""}`;
  return `${s}ث`;
}

export type ShipDetailsData = {
  level: number;
  catalogCode?: string | null;
  img?: string;
  hp?: number | null;
  maxHp?: number | null;
  capacity?: number | null;
  stars?: number | null;
  maxStars?: number | null;
};

export default function ShipDetailsModal({
  ship,
  onClose,
}: {
  ship: ShipDetailsData;
  onClose: () => void;
}) {
  const def: ShipDef = ship.catalogCode
    ? getShipByCode(ship.catalogCode)
    : getShipByMarketLevel(ship.level);

  const maxHp = ship.maxHp ?? def.maxHp;
  const curHp = Math.max(0, ship.hp ?? maxHp);
  const hpPct = maxHp > 0 ? Math.max(0, Math.min(100, (curHp / maxHp) * 100)) : 100;
  const capacity = ship.capacity ?? def.storage;
  const pool = def.fishPool.map((id) => FISH[id]).filter(Boolean);

  const stat = (icon: string, label: string, value: string, tone = "text-amber-100") => (
    <div
      className="rounded-xl px-2.5 py-2 flex flex-col gap-0.5"
      style={{
        background: "linear-gradient(180deg, rgba(30,41,59,0.95), rgba(2,6,23,0.95))",
        border: "1px solid rgba(251,191,36,0.28)",
        boxShadow: "inset 0 1px 0 rgba(255,236,180,0.18)",
      }}
    >
      <div className="text-[10px] text-slate-400 font-bold flex items-center gap-1">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className={`text-[13px] font-black tabular-nums ${tone}`} dir="ltr">
        {value}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: "rgba(2,6,23,0.82)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="relative w-full max-w-sm max-h-[86vh] overflow-y-auto rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{
          background:
            "radial-gradient(120% 80% at 50% 0%, rgba(30,58,95,0.98) 0%, rgba(2,6,23,0.99) 60%)",
          border: "1.5px solid rgba(251,191,36,0.6)",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,236,180,0.35), 0 0 40px rgba(251,191,36,0.12)",
        }}
      >
        {/* Gold header band */}
        <div
          className="sticky top-0 z-10 px-4 py-2.5 flex items-center justify-between"
          style={{
            background: "linear-gradient(180deg, rgba(120,53,15,0.95), rgba(2,6,23,0.95))",
            borderBottom: "1px solid rgba(251,191,36,0.45)",
          }}
        >
          <div className="text-amber-200 font-black text-sm">⚓ تفاصيل السفينة</div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full grid place-items-center text-amber-100 font-black active:scale-95"
            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(251,191,36,0.5)" }}
            aria-label="إغلاق"
          >
            ✕
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Hero */}
          <div className="flex items-center gap-3">
            <div
              className="w-24 h-24 shrink-0 rounded-xl grid place-items-center overflow-hidden"
              style={{
                background: "radial-gradient(circle at 50% 40%, rgba(56,189,248,0.22), rgba(0,0,0,0.6))",
                border: "1px solid rgba(251,191,36,0.35)",
              }}
            >
              <img src={ship.img || def.image} alt={def.name} className="w-full h-full object-contain" />
            </div>
            <div className="min-w-0 flex flex-col gap-1">
              <div className="text-base font-black text-amber-100 truncate">{def.name}</div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full text-amber-200"
                  style={{ background: "rgba(251,191,36,0.14)", border: "1px solid rgba(251,191,36,0.45)" }}
                >
                  {RARITY_AR[def.rarity] ?? def.rarity}
                </span>
                <span
                  className="text-[10px] font-black px-2 py-0.5 rounded-full text-cyan-200"
                  style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.4)" }}
                >
                  مستوى {def.marketLevel}
                </span>
                {!!ship.stars && (
                  <span className="text-[11px] text-amber-300 font-black">
                    {"★".repeat(ship.stars)}
                    <span className="text-slate-600">{"★".repeat(Math.max(0, (ship.maxStars ?? 5) - ship.stars))}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* HP bar */}
          <div>
            <div className="flex items-center justify-between text-[11px] font-black mb-1">
              <span className="text-slate-300">❤️ دم السفينة</span>
              <span className="text-emerald-200 tabular-nums" dir="ltr">
                {Math.round(hpPct)}% · {fmt(curHp)}/{fmt(maxHp)}
              </span>
            </div>
            <div className="h-3 rounded-full bg-black/80 border border-white/15 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${hpPct}%`,
                  background:
                    hpPct > 60
                      ? "linear-gradient(180deg,#7dffb4,#16a34a)"
                      : hpPct > 30
                      ? "linear-gradient(180deg,#ffe08a,#d97706)"
                      : "linear-gradient(180deg,#ffb0b0,#dc2626)",
                }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            {stat("📦", "سعة الحمولة", fmt(capacity))}
            {stat("🛡️", "الدرع", fmt(def.armor))}
            {stat("💨", "السرعة", fmt(def.speed))}
            {stat("🎣", "مدة الصيد", duration(def.fishingSeconds), "text-cyan-100")}
            {stat("🛠️", "مدة الإصلاح", duration(def.repairSeconds), "text-orange-100")}
            {stat("💰", "السعر", def.price > 0 ? fmt(def.price) : "حصرية", "text-yellow-100")}
          </div>

          {/* Fish pool */}
          <div>
            <div className="text-[11px] font-black text-slate-300 mb-1.5">🐟 الأسماك التي تصطادها</div>
            <div className="flex flex-col gap-1.5">
              {pool.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-2 rounded-xl px-2 py-1.5"
                  style={{
                    background: "linear-gradient(90deg, rgba(30,41,59,0.9), rgba(2,6,23,0.9))",
                    border: "1px solid rgba(148,163,184,0.22)",
                  }}
                >
                  {f.img ? (
                    <img src={f.img} alt={f.name} className="w-8 h-8 object-contain shrink-0" />
                  ) : (
                    <span className="text-lg">{f.emoji}</span>
                  )}
                  <span className="text-[12px] font-bold text-slate-100 truncate flex-1">{f.name}</span>
                  <span className="text-[12px] font-black text-amber-200 tabular-nums" dir="ltr">
                    {fmt(f.price)} 🪙
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Flavor */}
          <div
            className="rounded-xl px-3 py-2 text-[11px] leading-relaxed text-amber-100/90"
            style={{
              background: "rgba(251,191,36,0.08)",
              border: "1px solid rgba(251,191,36,0.28)",
            }}
          >
            {def.flavor}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
