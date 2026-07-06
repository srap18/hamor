import { STORE_PACKS } from './src/lib/store-catalog.ts';
import { ELITE_VIP_TIERS } from './src/lib/elite-vip.ts';
const out = {
  packs: STORE_PACKS.map(p => ({
    id: p.id, category: p.category, label: p.label,
    priceUSD: p.priceUSD, subscription: !!p.subscription,
    description: p.description || '', emoji: p.emoji || '',
  })),
  elite: ELITE_VIP_TIERS.map(t => ({
    id: t.paddlePriceId, level: t.level, nameAr: t.nameAr,
    emoji: t.emoji, priceUSD: t.monthlyPriceUsd,
    perks: t.perks,
  })),
};
console.log(JSON.stringify(out));
