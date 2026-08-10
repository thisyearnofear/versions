// MODULAR: Pure license pricing. No I/O — a usage-type → fee schedule.
// A tiny, opinionated schedule is enough for a non-scaling first license
// flow: the real value is the pre-cleared, attributed, settled *outcome*,
// not the exact number. Amounts are USDC decimal strings (6-decimal math
// compatible with the Arc adapter's micro-USD parsing).

export const LICENSE_USAGE_TYPES = ['sync_ad', 'sync_tv_film', 'sync_digital', 'other'] as const;
export type LicenseUsageType = (typeof LICENSE_USAGE_TYPES)[number];

export const LICENSE_FEES: Record<LicenseUsageType, string> = {
  sync_ad: '150.00',
  sync_tv_film: '250.00',
  sync_digital: '75.00',
  other: '100.00',
};

export function licenseFeeUsdc(usage: LicenseUsageType): string {
  return LICENSE_FEES[usage];
}