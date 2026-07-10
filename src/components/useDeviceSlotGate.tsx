import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SlotWarningModal, DeviceBlockedModal, DeviceMigrationModal } from "./DeviceSlotGate";

type SlotState =
  | { kind: "idle" }
  | { kind: "confirm"; hardwareHash: string; freeSlots: number; onDone: () => void }
  | { kind: "migrate"; hardwareHash: string; userId: string; candidates: any[]; onDone: () => void }
  | { kind: "blocked"; hardwareHash: string; hasPendingAppeal: boolean; cooldownUntil: string | null };

/**
 * Runs the device-slot flow after a successful sign-in/sign-up.
 * Returns a controller and the rendered gate UI.
 *
 *   const gate = useDeviceSlotGate();
 *   // after supabase.auth.signIn success:
 *   const ok = await gate.checkAndProceed(userId, email);
 *   if (ok) nav({ to: "/" });
 *   // ...render gate.node somewhere in your JSX
 */
export function useDeviceSlotGate() {
  const [state, setState] = useState<SlotState>({ kind: "idle" });

  async function checkAndProceed(userId: string, email: string | null): Promise<boolean> {
    try {
      const { getDeviceFingerprint } = await import("@/lib/device-fingerprint");
      const { hash, signals } = await getDeviceFingerprint();
      if (!hash) return true;

      const { deviceSlotCheck, deviceMigrationCandidates } = await import("@/lib/device-slots.functions");
      const res: any = await deviceSlotCheck({ data: { hardwareHash: hash, signals, userId, email } });
      const canonicalHash = res.canonicalHash || hash;

      if (res.action === "allowed") return true;

      if (res.action === "needs_confirmation") {
        // Check if legacy migration is needed (>2 historical accounts on device)
        const cands: any = await deviceMigrationCandidates({ data: { hardwareHash: canonicalHash } });
        const list = cands?.candidates || [];
        if (list.length > 2) {
          return await new Promise<boolean>((resolve) => {
            setState({
              kind: "migrate",
              hardwareHash: canonicalHash,
              userId,
              candidates: list,
              onDone: () => { setState({ kind: "idle" }); resolve(true); },
            });
          });
        }
        return await new Promise<boolean>((resolve) => {
          setState({
            kind: "confirm",
            hardwareHash: canonicalHash,
            freeSlots: res.free_slots ?? 1,
            onDone: () => { setState({ kind: "idle" }); resolve(true); },
          });
        });
      }

      if (res.action === "blocked") {
        // Sign out immediately so a blocked user isn't logged in
        try { await supabase.auth.signOut(); } catch {}
        setState({
          kind: "blocked",
          hardwareHash: canonicalHash,
          hasPendingAppeal: !!res.has_pending_appeal,
          cooldownUntil: res.appeal_cooldown_until || null,
        });
        return false;
      }
    } catch { /* fail open on unexpected errors */ }
    return true;
  }

  const node = (() => {
    if (state.kind === "confirm") {
      return (
        <SlotWarningModal
          freeSlots={state.freeSlots}
          lockDays={14}
          onCancel={async () => {
            try { await supabase.auth.signOut(); } catch {}
            setState({ kind: "idle" });
          }}
          onConfirm={async () => {
            try {
              const { deviceAssignSlot } = await import("@/lib/device-slots.functions");
              await deviceAssignSlot({ data: { hardwareHash: state.hardwareHash } });
            } catch {}
            state.onDone();
          }}
        />
      );
    }
    if (state.kind === "migrate") {
      return (
        <DeviceMigrationModal
          hardwareHash={state.hardwareHash}
          candidates={state.candidates}
          currentUserId={state.userId}
          onCancel={async () => {
            try { await supabase.auth.signOut(); } catch {}
            setState({ kind: "idle" });
          }}
          onDone={async () => {
            // After migration, current user should now own a slot; assign explicitly just in case
            try {
              const { deviceAssignSlot } = await import("@/lib/device-slots.functions");
              await deviceAssignSlot({ data: { hardwareHash: state.hardwareHash } });
            } catch {}
            state.onDone();
          }}
        />
      );
    }
    if (state.kind === "blocked") {
      return (
        <DeviceBlockedModal
          hardwareHash={state.hardwareHash}
          hasPendingAppeal={state.hasPendingAppeal}
          cooldownUntil={state.cooldownUntil}
          onClose={() => setState({ kind: "idle" })}
        />
      );
    }
    return null;
  })();

  return { checkAndProceed, node };
}
