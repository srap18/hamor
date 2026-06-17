// Shopify products are priced in USD, so we display USD everywhere to match
// exactly what the user sees at checkout. Avoids any "shown price ≠ paid
// price" confusion.
export const SAR_PER_USD = 3.75;

export function formatSarFromUsd(usd: number) {
  // Kept name for backwards compatibility — now returns USD to match the
  // Shopify checkout currency.
  return `$${usd.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(usd) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatUsd(usd: number) {
  return formatSarFromUsd(usd);
}
