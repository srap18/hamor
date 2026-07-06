/**
 * Google Play requires Product IDs to be [a-z0-9_.] and ≤ 40 chars (we
 * constrain to ≤ 20 for the store CSV). Some canonical pack IDs in
 * `store-catalog.ts` are longer than 20, so we map them here.
 *
 * This is the SINGLE source of truth shared between:
 *   - `assets/google_play_iap/in_app_products.csv` (uploaded to Play Console)
 *   - `src/lib/iap.ts` (translates internal ↔ Play IDs at purchase time)
 *
 * Keep in sync with `/mnt/documents/google_play_iap/id_map.json`.
 */

/** Internal pack id → Google Play Product ID (only entries that differ). */
export const INTERNAL_TO_PLAY_ID: Record<string, string> = {
  offer_gems_550_15off: "gems_o_550",
  offer_gems_1250_15off: "gems_o_1250",
  offer_gems_2800_15off: "gems_o_2800",
  offer_gems_7500_15off: "gems_o_7500",
  offer_frame_phoenix_set: "frame_phoenix",
  offer_frame_legendary_set: "frame_legendary",
  offer_frame_mythic_set: "frame_mythic",
  offer_ad_bomb_mega_200: "adbomb_mega_200",
  offer_shield_15d_bonus: "shield_15d_bonus",
  cr_golden_fisher_2pack: "cr_gold_fisher_2p",
};

/** Reverse map: Google Play Product ID → internal pack id. */
export const PLAY_TO_INTERNAL_ID: Record<string, string> = Object.fromEntries(
  Object.entries(INTERNAL_TO_PLAY_ID).map(([k, v]) => [v, k]),
);

export function toPlayId(internalId: string): string {
  return INTERNAL_TO_PLAY_ID[internalId] ?? internalId;
}

export function fromPlayId(playId: string): string {
  return PLAY_TO_INTERNAL_ID[playId] ?? playId;
}
