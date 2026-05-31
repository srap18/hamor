import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

function ConfirmUI({ opts, onClose }: { opts: ConfirmOptions; onClose: (ok: boolean) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(true); }, []);
  const close = (ok: boolean) => { setOpen(false); setTimeout(() => onClose(ok), 150); };
  return (
    <div
      dir="rtl"
      onClick={() => close(false)}
      className={`fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`mx-4 w-full max-w-sm rounded-2xl border-2 border-amber-500/40 bg-gradient-to-b from-slate-900 to-slate-950 p-5 shadow-2xl transition-transform ${open ? "scale-100" : "scale-95"}`}
      >
        {opts.title && <div className="mb-2 text-base font-black text-amber-300">{opts.title}</div>}
        <div className="text-sm font-bold text-white/90 leading-relaxed whitespace-pre-line">{opts.message}</div>
        <div className="mt-5 flex gap-2">
          <button
            onClick={() => close(false)}
            className="flex-1 rounded-xl bg-slate-700 py-2.5 text-sm font-black text-white active:scale-95"
          >
            {opts.cancelText ?? "إلغاء"}
          </button>
          <button
            onClick={() => close(true)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-black text-white active:scale-95 ${opts.danger ? "bg-gradient-to-b from-rose-600 to-rose-800" : "bg-gradient-to-b from-emerald-600 to-emerald-800"}`}
          >
            {opts.confirmText ?? "تأكيد"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const cleanup = (ok: boolean) => {
      resolve(ok);
      setTimeout(() => { root.unmount(); host.remove(); }, 200);
    };
    root.render(<ConfirmUI opts={opts} onClose={cleanup} />);
  });
}
