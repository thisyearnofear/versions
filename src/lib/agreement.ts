// MODULAR: the ONE blanket agreement. Suppliers accept it once when creating
// a listing; channels accept it once when registering. There is deliberately
// no per-listing contract, no per-transaction consent, and no bespoke terms —
// that is the model (NCS runs ~500B plays on a single blanket agreement
// instead of negotiated deals).
//
// Pure module: no I/O, no DB. The version string is what gets stamped on
// listings.agreement_version / channels.agreement_version so a later revision
// is auditable against the rows that accepted it.

export type AgreementRole = 'supplier' | 'channel';

export const AGREEMENT_VERSION = 'marketplace-1.0.0';
export const AGREEMENT_PATH = '/legal/agreement';

export interface Agreement {
  version: string;
  path: string;
  role: AgreementRole;
  title: string;
  /** Click-through body rendered at acceptance time. */
  terms: string[];
  /** The single sentence the acceptor is agreeing to. */
  acceptance: string;
}

const SHARED: string[] = [
  'VERSIONS is a marketplace, not a rights clearance service. We match supply to distribution channels, record attribution, and settle paid placements. We do not negotiate terms per listing and do not grant rights beyond this agreement.',
  'Money moves on Arc in USDC. Paid placements settle through a flat three-way split — supplier, channel, platform — published in the product, not negotiated.',
  'Either party may stop at any time. Removing a listing or a channel ends future use; it does not retroactively revoke use that already happened under this agreement.',
];

const SUPPLIER_TERMS: string[] = [
  'You may list a track you control (music) or a brand/product you are authorized to promote (placement). You are responsible for having the right to offer it.',
  'A FREE listing grants any registered channel a non-exclusive right to use it in their content, worldwide, for as long as the listing stays active. The only condition is attribution: the channel must render the attribution string we generate, unmodified, wherever the content is published.',
  'A PAID listing is offered at the price you set — a flat fee or a CPM. A channel buys it self-serve; you do not negotiate with them and they do not negotiate with you.',
  'Free use is not monetized use. A channel that wants to run your listing against paid sponsorship or a monetized campaign must buy a slot.',
  'You keep your rights. This agreement is a distribution permission, not an assignment, and it does not license your work for model training.',
];

const CHANNEL_TERMS: string[] = [
  'You must connect a real distribution surface (a YouTube channel at minimum). We pull your subscriber and view counts from the platform itself — self-reported reach is never accepted, and a channel that fails verification cannot buy a paid slot.',
  'FREE listings may be used in your content at no cost, provided you render the generated attribution string unmodified and keep the link live for as long as the content is published.',
  'PAID listings require a slot. You set the budget, pick flat-fee or CPM, and check out — no sales call. Serving stops automatically when the budget is spent.',
  'Sponsored content carries a disclosure obligation. Every paid placement ships with a disclosure marker that you must render alongside the attribution. This applies to AI-run channels exactly as it does to human ones.',
  'Report what you used. Every placement — free or paid — should be logged with where it ran (video URL when available). Unreported use is a breach; reported use is what makes the catalog worth more to everyone in it.',
];

export function agreementFor(role: AgreementRole): Agreement {
  return {
    version: AGREEMENT_VERSION,
    path: AGREEMENT_PATH,
    role,
    title:
      role === 'supplier'
        ? 'VERSIONS Supplier Agreement'
        : 'VERSIONS Channel Agreement',
    terms: role === 'supplier' ? [...SUPPLIER_TERMS, ...SHARED] : [...CHANNEL_TERMS, ...SHARED],
    acceptance:
      role === 'supplier'
        ? 'I control what I am listing and I accept the blanket terms above for every listing I create.'
        : 'I operate this distribution surface and I accept the blanket terms above, including attribution and disclosure.',
  };
}

/**
 * Guard for the accept path: a click-through is only valid against the
 * version the UI actually rendered. Stale clients posting an old version are
 * rejected rather than silently upgraded, so the stamped version on a row
 * always matches terms the acceptor saw.
 */
export function isCurrentAgreementVersion(version: unknown): version is string {
  return version === AGREEMENT_VERSION;
}
