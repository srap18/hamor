import { supabase } from "@/integrations/supabase/client";

// Thin wrappers around server-side SECURITY DEFINER RPCs.
// All currency / inventory / ship / quest mutations MUST go through these
// to prevent client-side cheating.

export async function buyWithGems(itemId: string, itemType: string, gemsCost: number, meta?: unknown, count: number = 1) {
  return supabase.rpc("buy_with_gems", { _item_id: itemId, _item_type: itemType, _gems_cost: gemsCost, _meta: (meta ?? null) as never, _count: count } as never);
}

export async function buyWithCoins(itemId: string, itemType: string, coinsCost: number, meta?: unknown, count: number = 1) {
  return supabase.rpc("buy_with_coins", { _item_id: itemId, _item_type: itemType, _coins_cost: coinsCost, _meta: (meta ?? null) as never, _count: count } as never);
}

export async function buyWithCoinsGemFallback(itemId: string, itemType: string, coinsCost: number, meta?: unknown, count: number = 1) {
  return supabase.rpc("buy_with_coins_gem_fallback" as never, { _item_id: itemId, _item_type: itemType, _coins_cost: coinsCost, _meta: (meta ?? null) as never, _count: count } as never);
}

export async function buyProtection(days: number, coinsCost: number, gemsCost: number) {
  return supabase.rpc("buy_protection", { _days: days, _coins_cost: coinsCost, _gems_cost: gemsCost });
}

export async function buyShieldToInventory(itemId: string, qty: number, coinsCost: number, gemsCost: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.rpc as any)("buy_shield_to_inventory", { _item_id: itemId, _qty: qty, _coins_cost: coinsCost, _gems_cost: gemsCost });
}

export async function buyShipRpc(templateId: number) {
  return supabase.rpc("buy_ship", { _template_id: templateId });
}

export async function repairShipInstant(shipId: string, gemsCost: number) {
  return supabase.rpc("repair_ship_instant", { _ship_id: shipId, _gems_cost: gemsCost });
}

export async function giftGold(recipientId: string, amount: number) {
  return supabase.rpc("gift_gold", { _recipient: recipientId, _amount: amount });
}

export async function giftGems(recipientId: string, amount: number) {
  return supabase.rpc("gift_gems" as any, { _recipient: recipientId, _amount: amount });
}

export async function claimDailyLogin() {
  return supabase.rpc("claim_daily_login");
}


export async function sellFish(fishStockIds: string[]) {
  return supabase.rpc("sell_fish", { _fish_stock_ids: fishStockIds });
}

export async function setShipAtSea(shipId: string, atSea: boolean) {
  return supabase.rpc("set_ship_at_sea", { _ship_id: shipId, _at_sea: atSea });
}

export async function buyLootbox(typeId: string) {
  return supabase.rpc("buy_lootbox", { _type_id: typeId });
}

export async function openLootbox(boxId: string) {
  return supabase.rpc("open_lootbox", { _box_id: boxId });
}

export async function claimQuest(questId: string, dayKey: string) {
  return supabase.rpc("claim_quest", { _quest_id: questId, _day_key: dayKey });
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
  return supabase.rpc("sell_ship", { _ship_id: shipId, _refund_coins: refundCoins });
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
  return supabase.rpc("buy_ship_by_code", { _code: code, _template_id: templateId, _price_coins: priceCoins, _max_hp: maxHp });
}

export async function marketStartUpgrade() {
  return supabase.rpc("market_start_upgrade");
}

export async function marketFinishUpgradeWithGems() {
  return supabase.rpc("market_finish_upgrade_with_gems");
}

export async function deductGemsForVoiceChange(userId: string, amount = 200) {
  return supabase.rpc("deduct_gems_for_voice_change", { _user_id: userId, _amount: amount });
}
