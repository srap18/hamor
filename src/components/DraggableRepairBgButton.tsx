import { DraggableActionButton } from "./DraggableActionButton";

/**
 * Floating, collapsible, draggable repair-burned-bg button.
 * Position is persisted per-key via localStorage.
 */
export function DraggableRepairBgButton({
  storageKey,
  onRepair,
  label = "إصلاح الخلفية",
}: {
  storageKey: string;
  onRepair: () => Promise<void> | void;
  label?: string;
}) {
  return (
    <DraggableActionButton
      storageKey={storageKey}
      onClick={onRepair}
      label={
        <>
          🛠️ {label} <span className="text-cyan-200">💎100</span>
        </>
      }
      collapsedIcon={<>🛠️</>}
      title="إصلاح الخلفية"
      variant="emerald"
    />
  );
}
