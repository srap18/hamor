/**
 * Legacy Google Play products that are still LIVE in Play Console (players
 * keep renewing them) but were removed from the in-app catalog
 * (`STORE_PACKS` / `ELITE_VIP_TIERS`).
 *
 * Without these definitions the receipt verifier throws
 * `unknown product: vip_monthly` — the player is charged by Google and gets
 * nothing. Keep an entry here for every product that can still be charged.
 */

export type LegacyPlayProduct = {
  /** Play product / subscription id. */
  id: string;
  label: string;
  priceUSD: number;
  subscription: boolean;
  reward: {
    gems?: number;
    coins?: number;
    rubies?: number;
    shieldDays?: number;
    vipDays?: number;
  };
};

export const LEGACY_PLAY_PRODUCTS: LegacyPlayProduct[] = [
  {
    id: "vip_monthly",
    label: "VIP شهري",
    priceUSD: 9.99,
    subscription: true,
    reward: { gems: 6000, vipDays: 30 },
  },
];

export function getLegacyPlayProduct(id: string): LegacyPlayProduct | undefined {
  return LEGACY_PLAY_PRODUCTS.find((p) => p.id === id);
}
