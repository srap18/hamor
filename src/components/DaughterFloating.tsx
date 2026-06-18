import { useState } from "react";
import { useDaughter } from "@/hooks/use-daughter";
import { STAGE_IMAGES } from "@/lib/daughter";
import { DaughterModal } from "@/components/DaughterModal";

export function DaughterFloating() {
  const { daughter } = useDaughter();
  const [open, setOpen] = useState(false);
  if (!daughter) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-3 z-40 w-16 h-16 rounded-full bg-gradient-to-b from-amber-600 to-amber-800 border-2 border-amber-300/80 shadow-[0_4px_16px_rgba(0,0,0,0.6)] active:scale-95 overflow-hidden flex items-end justify-center hover:from-amber-500"
        aria-label={`فتح ${daughter.name}`}
      >
        <img
          src={STAGE_IMAGES[daughter.stage]}
          alt={`صورة الشخصية ${daughter.name}`}
          className="w-full h-full object-contain object-bottom pointer-events-none"
        />
        <span className="absolute -top-1 -right-1 bg-amber-300 text-stone-900 text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center border border-amber-900">
          {daughter.stage}
        </span>
      </button>
      <DaughterModal open={open} onOpenChange={setOpen} />
    </>
  );
}
