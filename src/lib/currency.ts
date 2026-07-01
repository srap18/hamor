export const SAR_PER_USD = 3.75;
export const VAT_RATE = 0.15;

export function formatSarFromUsd(usd: number, { includeVat = true } = {}) {
  const sar = usd * SAR_PER_USD * (includeVat ? 1 + VAT_RATE : 1);
  return `${sar.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(sar) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ر.س`;
}

