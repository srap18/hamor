export const SAR_PER_USD = 3.75;
export const VAT_RATE = 0.15;

export function formatSarFromUsd(usd: number, { includeVat = true } = {}) {
  const total = usd * (includeVat ? 1 + VAT_RATE : 1);
  return `$${total.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(total) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}
