import { supabase } from "@/integrations/supabase/client";
import { applyOptimisticProfileDelta, refreshProfile } from "@/hooks/use-auth";

// Thin wrappers around server-side SECURITY DEFINER RPCs.
// All currency / inventory / ship / quest mutations MUST go through these
// to prevent client-side cheating.
//
// Most "deduction" wrappers apply an Optimistic UI update to the cached
// profile (coins/gems) immediately, then call the RPC. On error we roll
// back the delta and surface the original error to the caller. On success
// the realtime postgres_changes subscription on `profiles` reconciles the
// authoritative value automatically; we also trigger refreshProfile() as a
// safety net.

type RpcResult<T = unknown> = { data: T | null; error: any };

async function withOptimistic<T>(
  delta: Parameters<typeof applyOptimisticProfileDelta>[0],
  run: () => Promise<RpcResult<T>>,
): Promise<RpcResult<T>> {
  const rollback = applyOptimisticProfileDelta(delta);
  try {
    const res = await run();
    if (res.error) {
      rollback();
    } else {
      // Reconcile with server-truth shortly after (realtime usually wins first).
      setTimeout(() => refreshProfile(), 50);
    }
    return res;
  } catch (e) {
    rollback();
    throw e;
  }
}

export async function buyWithGems(itemId: string, itemType: string, gemsCost: number, meta?: unknown, count: number = 1) {
  return withOptimistic({ gems: -Math.abs(gemsCost) }, () =>
    supabase.rpc("buy_with_gems", { _item_id: itemId, _item_type: itemType, _gems_cost: gemsCost, _meta: (meta ?? null) as never, _count: count } as never) as unknown as Promise<RpcResult>,
  );
}

export async function buyWithCoins(itemId: string, itemType: string, coinsCost: number, meta?: unknown, count: number = 1) {
  return withOptimistic({ coins: -Math.abs(coinsCost) }, () =>
    supabase.rpc("buy_with_coins", { _item_id: itemId, _item_type: itemType, _coins_cost: coinsCost, _meta: (meta ?? null) as never, _count: count } as never) as unknown as Promise<RpcResult>,
  );
}

export async function buyWithCoinsGemFallback(itemId: string, itemType: string, coinsCost: number, meta?: unknown, count: number = 1) {
  // Server may pay with coins OR fall back to gems — can't predict which.
  // Skip optimistic; rely on realtime reconcile.
  const res = await supabase.rpc("buy_with_coins_gem_fallback" as never, { _item_id: itemId, _item_type: itemType, _coins_cost: coinsCost, _meta: (meta ?? null) as never, _count: count } as never);
  if (!res.error) setTimeout(() => refreshProfile(), 50);
  return res;
}

export async function buyShipRpc(templateId: number) {
  return supabase.rpc("buy_ship", { _template_id: templateId });
}


export async function setShipAtSea(shipId: string, atSea: boolean) {
  return supabase.rpc("set_ship_at_sea", { _ship_id: shipId, _at_sea: atSea });
}

export async function buyLootbox(typeId: string) {
  const res = await supabase.rpc("buy_lootbox", { _type_id: typeId });
  if (!res.error) setTimeout(() => refreshProfile(), 50);
  return res;
}

export async function openLootbox(boxId: string) {
  const res = await supabase.rpc("open_lootbox", { _box_id: boxId });
  if (!res.error) setTimeout(() => refreshProfile(), 50);
  return res;
}

export async function claimQuest(questId: string, dayKey: string) {
  const res = await supabase.rpc("claim_quest", { _quest_id: questId, _day_key: dayKey });
  if (!res.error) setTimeout(() => refreshProfile(), 50);
  return res;
}

export async function setMyTribe(tribeId: string | null) {
  return supabase.rpc("set_my_tribe", { _tribe_id: tribeId as never });
}

export async function officerSetTribe(target: string, tribeId: string | null) {
  return supabase.rpc("officer_set_tribe", { _target: target, _tribe_id: tribeId as never });
}

export async function consumeInventoryItem(itemId: string, itemType: string, count = 1) {
  return supabase.rpc("consume_inventory_item", { _item_id: itemId, _item_type: itemType, _count: count });
}

export async function updateInventoryMeta(invId: string, meta: unknown) {
  return supabase.rpc("update_inventory_meta", { _inv_id: invId, _meta: (meta ?? null) as never });
}

export async function getMyWallet() {
  return supabase.rpc("get_my_wallet");
}

export async function sellShip(shipId: string, refundCoins: number) {
  return withOptimistic({ coins: +Math.abs(refundCoins) }, () =>
    supabase.rpc("sell_ship", { _ship_id: shipId, _refund_coins: refundCoins }) as unknown as Promise<RpcResult>,
  );
}

export async function deleteInventoryRows(ids: string[]) {
  return supabase.rpc("delete_inventory_rows", { _ids: ids });
}

export async function splitInventoryAssign(invId: string, newMeta: unknown) {
  return supabase.rpc("split_inventory_assign", { _inv_id: invId, _new_meta: (newMeta ?? null) as never });
}


export async function incrementFishCaught(fishId: string, qty: number) {
  return supabase.rpc("increment_fish_caught", { _fish_id: fishId, _qty: qty });
}

export async function adminSetPlayerCurrency(playerId: string, coins: number, gems: number, xp: number, level: number) {
  return supabase.rpc("admin_set_player_currency", { _player: playerId, _coins: coins, _gems: gems, _xp: xp, _level: level });
}

export async function adminGrantLootbox(playerId: string, typeId: string) {
  return supabase.rpc("admin_grant_lootbox", { _player: playerId, _type_id: typeId });
}

export async function adminMassGift(coins: number, gems: number, xp: number) {
  return supabase.rpc("admin_mass_gift", { _coins: coins, _gems: gems, _xp: xp });
}

export async function buyShipByCode(code: string, templateId: number, priceCoins: number, maxHp: number) {
  return withOptimistic({ coins: -Math.abs(priceCoins) }, () =>
    supabase.rpc("buy_ship_by_code", { _code: code, _template_id: templateId, _price_coins: priceCoins, _max_hp: maxHp }) as unknown as Promise<RpcResult>,
  );
}

export async function marketStartUpgrade() {
  return supabase.rpc("market_start_upgrade");
}

export async function marketFinishUpgradeWithGems() {
  return supabase.rpc("market_finish_upgrade_with_gems");
}

export async function deductGemsForVoiceChange(userId: string, amount = 200) {
  return withOptimistic({ gems: -Math.abs(amount) }, () =>
    supabase.rpc("deduct_gems_for_voice_change", { _user_id: userId, _amount: amount }) as unknown as Promise<RpcResult>,
  );
}
