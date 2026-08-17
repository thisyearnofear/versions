// MODULAR: Pure license pricing. No I/O — the server's usage-type → fee
// schedule and current standard terms. These values make an indicative
// platform quote available; they do not establish rights clearance. Amounts
// are USDC decimal strings (6-decimal math compatible with the Arc adapter's
// micro-USD parsing).

export const DEFAULT_LICENSE_TERRITORY = 'worldwide' as const;
export const DEFAULT_LICENSE_TERM_MONTHS = 12 as const;
export const LICENSE_USAGE_TYPES = ['sync_ad', 'sync_tv_film', 'sync_digital', 'other'] as const;
export type LicenseUsageType = (typeof LICENSE_USAGE_TYPES)[number];

export const LICENSE_FEES: Record<LicenseUsageType, string> = {
  sync_ad: '1.00',
  sync_tv_film: '1.00',
  sync_digital: '1.00',
  other: '1.00',
};

export function licenseFeeUsdc(usage: LicenseUsageType): string {
  return LICENSE_FEES[usage];
}