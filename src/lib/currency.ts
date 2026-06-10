export const SAR_PER_USD = 3.75;

export function formatSarFromUsd(usd: number) {
  const sar = usd * SAR_PER_USD;
  return `${sar.toLocaleString("en-US", {
    minimumFractionDigits: Number.isInteger(sar) ? 0 : 2,
    maximumFractionDigits: 2,
  })} ر.س`;
}