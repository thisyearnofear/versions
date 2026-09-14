// MODULAR: Slots — the paid tier ("the ad infra").
//
// A slot is a purchased placement of a listing on a channel. It is
// self-serve end to end: a verified channel picks a paid listing, pays on
// the existing Arc rails, and gets a tracking code plus a disclosure-stamped
// attribution string it must render. No sales call, no bespoke contract, no
// per-track negotiation — the price is the one the supplier already set.
//
// SAFE: three independent gates stand between a request and money moving.
//  1. `canBuySlots(channel)` — a channel whose distribution numbers were not
//     verified against the platform can never buy. Same predicate the UI
//     reads, so a button cannot be enabled for a purchase this would refuse.
//  2. A fail-closed settlement lease. Only one caller can move a slot out of
//     `pending_payment`; a payment that throws leaves the lease held for
//     explicit reconciliation rather than reopening a slot that may already
//     have been charged.
//  3. An atomic guarded UPDATE for every spend movement (see `accrue`). The
//     cap check is in the WHERE clause of the same statement that increments,
//     so concurrent attribution events cannot both read "under budget" and
//     both write.
//
// CLEAN: slot money is a flat three-way split (supplier / channel / platform)
// built by settlement.ts. This module never computes a share itself — it
// collects the gross and hands it over. The leg-count invariant is asserted
// there, not here.
//
// DRY: micro-USDC parsing and formatting come from settlement.ts so the money
// format has one source of truth.

import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  channels as channelsTable,
  listings as listingsTable,
  slots as slotsTable,
  slotLegs as slotLegsTable,
} from '../lib/schema';
import { emit } from '../lib/event-bus';
import { emitDurable } from './outbox';
import { fromMicroUsdc, toMicroUsdc, type SettlementService } from './settlement';
import { canBuySlots } from './channels';
import { attributionCodeFor, newTrackingCode, trackingUrl } from '../lib/attribution';
import { log } from '../lib/logger';
import type {
  Disclosure,
  PricingModel,
  SlotRecipientRole,
  SlotStatus,
} from '../lib/types';
import type { ArcAdapter } from '../adapters/arc';

export type SlotFailureCode =
  | 'LISTING_NOT_FOUND'
  | 'LISTING_NOT_PAID'
  | 'LISTING_NOT_SERVABLE'
  | 'CHANNEL_NOT_FOUND'
  | 'CHANNEL_UNVERIFIED'
  | 'PRICING_MISMATCH'
  | 'BUDGET_REQUIRED'
  | 'INVALID_BUDGET'
  | 'BUDGET_BELOW_FEE'
  | 'CAMPAIGN_EXHAUSTED'
  | 'SLOT_NOT_FOUND'
  | 'SLOT_NOT_PAYABLE'
  | 'SETTLEMENT_IN_PROGRESS'
  | 'SETTLEMENT_CLAIM_LOST'
  | 'PAYMENT_FAILED';

export interface SlotLegRecord {
  recipient_role: SlotRecipientRole;
  recipient_wallet: string;
  amount_usdc: string;
  status: string;
  tx_hash: string | null;
}

export interface SlotRecord {
  id: string;
  listing_id: string;
  channel_id: string;
  buyer_wallet: string;
  pricing_model: PricingModel;
  flat_fee_usdc: string | null;
  cpm_usdc: string | null;
  budget_usdc: string | null;
  spent_usdc: string;
  /** Null when the slot is uncapped. What an advertiser actually watches. */
  budget_remaining_usdc: string | null;
  impressions_delivered: number;
  clicks_delivered: number;
  tracking_code: string;
  tracking_url: string;
  /**
   * The code a channel reports usage against: listing slug + this slot's
   * tracking code. Derived, never stored — the slug belongs to the listing,
   * and copying it here would let the two drift.
   */
  attribution_code: string;
  attribution_text: string;
  disclosure: Disclosure;
  status: SlotStatus;
  payment_tx_hash: string | null;
  payment_mock: boolean;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SlotResult =
  | { ok: true; slot: SlotRecord; alreadyExisted?: boolean }
  | { ok: false; code: SlotFailureCode; message: string };

export interface PaidSlotResult {
  ok: true;
  slot: SlotRecord;
  /** Gross collected from the buyer for this placement. */
  charged_usdc: string;
  tx_hash: string | null;
  mock: boolean;
  legs: SlotLegRecord[];
}

export type PaidSlotFailure = { ok: false; code: SlotFailureCode; message: string };
export type PaidSlotOutcome = PaidSlotResult | PaidSlotFailure;

export interface CreateSlotInput {
  listingId: string;
  channelId: string;
  buyerWallet: string;
  /** Required for CPM (it is the escrow). Optional ceiling for flat-fee. */
  budgetUsdc?: string | null;
}

export interface AccrueInput {
  slotId: string;
  impressions?: number;
  clicks?: number;
}

export interface AccrueResult {
  ok: true;
  slot: SlotRecord;
  /** Spend this event added. Zero for a flat-fee slot, which is pre-paid. */
  delta_usdc: string;
  /** True when this event took the slot or its campaign to the cap. */
  exhausted: boolean;
}

export type AccrueOutcome =
  | AccrueResult
  | { ok: false; code: 'SLOT_NOT_FOUND' | 'SLOT_NOT_ACTIVE' | 'BUDGET_EXHAUSTED'; message: string };

export interface SlotsService {
  create(input: CreateSlotInput): Promise<SlotResult>;
  /**
   * Collect payment and activate. Flat-fee slots settle their three legs
   * immediately; CPM slots escrow the budget and settle only what they
   * actually serve, at `complete`.
   */
  pay(slotId: string, buyerWallet: string): Promise<PaidSlotOutcome>;
  /**
   * Move delivered impressions/clicks onto a slot. The only writer of
   * `spent_usdc` other than `pay`, and the only place a delivery cap is
   * enforced.
   */
  accrue(input: AccrueInput): Promise<AccrueOutcome>;
  /**
   * End delivery. A CPM slot settles its accrued spend here and refunds
   * whatever the escrow did not use — the platform never keeps money for
   * impressions it did not deliver.
   */
  complete(slotId: string, buyerWallet: string): Promise<PaidSlotOutcome>;
  pause(slotId: string, wallet: string): Promise<SlotResult>;
  resume(slotId: string, wallet: string): Promise<SlotResult>;
  get(slotId: string): Promise<SlotRecord | null>;
  /** Lookup for the public tracking redirect. Deliberately not wallet-scoped. */
  getByTrackingCode(code: string): Promise<SlotRecord | null>;
  listForChannel(channelId: string, opts?: { limit?: number }): Promise<SlotRecord[]>;
  listForListing(listingId: string, opts?: { limit?: number }): Promise<SlotRecord[]>;
  listForBuyer(wallet: string, opts?: { limit?: number }): Promise<SlotRecord[]>;
  legs(slotId: string): Promise<SlotLegRecord[]>;
}

type SlotRow = typeof slotsTable.$inferSelect;
type ListingRow = typeof listingsTable.$inferSelect;
type SlotWithListing = { slot: SlotRow; listing: ListingRow };

/** Spend only counts against a slot that is actively serving. */
const SERVABLE: SlotStatus = 'active';

interface Charge {
  hash: string | null;
  mock: boolean;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/** Decimal USDC to micro, or null. Rejects negatives and malformed strings. */
function parseUsdc(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    const micro = toMicroUsdc(trimmed);
    return micro >= 0n ? micro : null;
  } catch {
    return null;
  }
}

function remaining(spent: string, budget: string | null): string | null {
  const cap = parseUsdc(budget);
  if (cap === null) return null;
  const used = parseUsdc(spent) ?? 0n;
  return fromMicroUsdc(cap > used ? cap - used : 0n);
}

function rowToSlot(row: SlotRow, listing: ListingRow): SlotRecord {
  return {
    id: row.id,
    listing_id: row.listingId,
    channel_id: row.channelId,
    buyer_wallet: row.buyerWallet,
    pricing_model: row.pricingModel,
    flat_fee_usdc: row.flatFeeUsdc,
    cpm_usdc: row.cpmUsdc,
    budget_usdc: row.budgetUsdc,
    spent_usdc: row.spentUsdc,
    budget_remaining_usdc: remaining(row.spentUsdc, row.budgetUsdc),
    impressions_delivered: row.impressionsDelivered,
    clicks_delivered: row.clicksDelivered,
    tracking_code: row.trackingCode,
    tracking_url: row.trackingUrl,
    attribution_code: attributionCodeFor(listing.attributionSlug, row.trackingCode),
    attribution_text: row.attributionText,
    disclosure: row.disclosure,
    status: row.status,
    payment_tx_hash: row.paymentTxHash,
    payment_mock: row.paymentMock,
    settled_at: toIso(row.settledAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function legRecords(rows: Array<{ recipientRole: string; recipientWallet: string; amountUsdc: string; status: string; txHash: string | null }>): SlotLegRecord[] {
  return rows.map((l) => ({
    recipient_role: l.recipientRole as SlotRecipientRole,
    recipient_wallet: l.recipientWallet,
    amount_usdc: l.amountUsdc,
    status: l.status,
    tx_hash: l.txHash,
  }));
}

const slotWithListing = { slot: slotsTable, listing: listingsTable };

export function createSlotsService({
  settlement,
  arc = null,
  platformWallet = null,
}: {
  settlement: Pick<SettlementService, 'insertSlotLegsAtomic' | 'settleSlotLegsAsync' | 'getLegsForSlot'>;
  arc?: ArcAdapter | null;
  platformWallet?: string | null;
}): SlotsService {
  async function loadSlot(slotId: string): Promise<SlotWithListing | null> {
    const [row] = await db
      .select(slotWithListing)
      .from(slotsTable)
      .innerJoin(listingsTable, eq(slotsTable.listingId, listingsTable.id))
      .where(eq(slotsTable.id, slotId))
      .limit(1);
    return row ? { slot: row.slot, listing: row.listing } : null;
  }

  /**
   * A slot belonging to another wallet is reported missing rather than
   * forbidden — the existence of someone else's campaign is not public.
   */
  async function loadOwned(
    slotId: string,
    wallet: string,
  ): Promise<SlotWithListing | { error: PaidSlotFailure }> {
    const found = await loadSlot(slotId);
    if (!found || found.slot.buyerWallet.toLowerCase() !== wallet.toLowerCase()) {
      return { error: { ok: false, code: 'SLOT_NOT_FOUND', message: 'Slot not found.' } };
    }
    return found;
  }

  /** Move money on the Arc rails, or report an honest mock when unconfigured. */
  async function transfer(from: string, to: string, amountUsdc: string): Promise<Charge> {
    if (!arc) return { hash: null, mock: true };
    const r = await arc.sendTransfer({ from, to, amountUsdc });
    return { hash: r.hash || null, mock: !!r.mock };
  }

  /**
   * Split a gross three ways and drive the legs on-chain. Both the flat-fee
   * purchase and the CPM completion settle through here, so no slot can reach
   * money by a path that skips the leg-count invariant.
   */
  async function settleGross(
    slotId: string,
    grossUsdc: string,
    supplierWallet: string,
    channelWallet: string,
  ): Promise<SlotLegRecord[]> {
    const legs = await settlement.insertSlotLegsAtomic({
      slotId,
      grossUsdc,
      supplierWallet,
      channelWallet,
      platformWallet: platformWallet || supplierWallet,
    });
    const results = await settlement.settleSlotLegsAsync(legs.map((l) => l.id));
    const byId = new Map(results.map((r) => [r.leg_id, r]));
    return legs.map((l) => ({
      recipient_role: l.recipient_role,
      recipient_wallet: l.recipient_wallet,
      amount_usdc: l.amount_usdc,
      status: byId.get(l.id)?.status ?? l.status,
      tx_hash: byId.get(l.id)?.tx_hash ?? null,
    }));
  }

  /**
   * Reserve against the supplier's campaign budget. `listings.budget_spent_usdc`
   * is COMMITTED spend, not delivered spend: it is taken once, atomically, when
   * a slot is paid, and released by `releaseCampaignSpend` when a CPM slot
   * finishes with escrow left over. Accrual never touches it.
   *
   * Delivery is still bounded by the campaign even though `accrue` does not
   * consult this counter: each slot's own budget is clamped to the campaign's
   * remaining headroom at creation, `accrue` caps that slot atomically, and a
   * CPM slot cannot serve past the escrow it actually paid for. So the sum of
   * what every slot can deliver can never exceed what the campaign committed.
   *
   * Returns false when the reservation would cross the cap — the caller must
   * not move money in that case.
   */
  async function moveCampaignSpend(listingId: string, deltaMicro: bigint): Promise<boolean> {
    if (deltaMicro <= 0n) return true;
    const delta = fromMicroUsdc(deltaMicro);
    const spent = sql`(CAST(${listingsTable.budgetSpentUsdc} AS NUMERIC) + CAST(${delta} AS NUMERIC))`;
    const cap = sql`CAST(${listingsTable.budgetCapUsdc} AS NUMERIC)`;
    const [row] = await db
      .update(listingsTable)
      .set({
        budgetSpentUsdc: sql`${spent}::TEXT`,
        status: sql`CASE
            WHEN ${listingsTable.budgetCapUsdc} IS NOT NULL AND ${spent} >= ${cap}
            THEN 'exhausted'
            ELSE ${listingsTable.status}
          END`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(listingsTable.id, listingId),
          sql`(${listingsTable.budgetCapUsdc} IS NULL OR ${spent} <= ${cap})`,
        ),
      )
      .returning();
    return !!row;
  }

  /**
   * Give unspent escrow back to the campaign gate. A decrement, so it needs no
   * guard — it can only ever create headroom.
   */
  async function releaseCampaignSpend(listingId: string, deltaMicro: bigint): Promise<void> {
    if (deltaMicro <= 0n) return;
    const delta = fromMicroUsdc(deltaMicro);
    await db
      .update(listingsTable)
      .set({
        budgetSpentUsdc: sql`GREATEST(
            CAST(${listingsTable.budgetSpentUsdc} AS NUMERIC) - CAST(${delta} AS NUMERIC),
            0
          )::TEXT`,
        status: sql`CASE
            WHEN ${listingsTable.status} = 'exhausted' AND ${listingsTable.budgetCapUsdc} IS NOT NULL
              AND CAST(${listingsTable.budgetSpentUsdc} AS NUMERIC) - CAST(${delta} AS NUMERIC)
                  < CAST(${listingsTable.budgetCapUsdc} AS NUMERIC)
            THEN 'active'
            ELSE ${listingsTable.status}
          END`,
        updatedAt: new Date(),
      })
      .where(eq(listingsTable.id, listingId));
  }

  async function setStatus(
    slotId: string,
    wallet: string,
    status: SlotStatus,
    from: SlotStatus[],
  ): Promise<SlotResult> {
    const found = await loadSlot(slotId);
    // Either party to the placement may take it offline: the buyer pauses
    // what they paid for, the supplier pulls their own creative. A stranger
    // gets the same "not found" as a bad id.
    const mine =
      !!found &&
      (found.slot.buyerWallet.toLowerCase() === wallet.toLowerCase() ||
        found.listing.supplierWallet.toLowerCase() === wallet.toLowerCase());
    if (!found || !mine) {
      return { ok: false, code: 'SLOT_NOT_FOUND', message: 'Slot not found.' };
    }
    const { slot, listing } = found;
    if (slot.status === status) return { ok: true, slot: rowToSlot(slot, listing) };
    if (!from.includes(slot.status)) {
      return {
        ok: false,
        code: 'SLOT_NOT_PAYABLE',
        message: `Cannot move a ${slot.status} placement to ${status}.`,
      };
    }
    const [row] = await db
      .update(slotsTable)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(slotsTable.id, slotId), eq(slotsTable.status, slot.status)))
      .returning();
    if (!row) return { ok: false, code: 'SLOT_NOT_FOUND', message: 'Slot not found.' };
    return { ok: true, slot: rowToSlot(row, listing) };
  }

  async function listSlots(where: ReturnType<typeof eq>, limit: number): Promise<SlotRecord[]> {
    const rows = await db
      .select(slotWithListing)
      .from(slotsTable)
      .innerJoin(listingsTable, eq(slotsTable.listingId, listingsTable.id))
      .where(where)
      .orderBy(desc(slotsTable.createdAt))
      .limit(limit);
    return rows.map((r) => rowToSlot(r.slot, r.listing));
  }

  return {
    async create({ listingId, channelId, buyerWallet, budgetUsdc = null }) {
      const wallet = buyerWallet.toLowerCase();

      const [listing] = await db
        .select()
        .from(listingsTable)
        .where(eq(listingsTable.id, listingId))
        .limit(1);
      if (!listing) {
        return { ok: false, code: 'LISTING_NOT_FOUND', message: 'Listing not found.' };
      }
      // Free supply is used under the blanket agreement with attribution — it
      // is not bought. Routing a free listing here would create a slot with no
      // price and therefore no way to settle it.
      if (listing.tier !== 'paid' || !listing.pricing) {
        return {
          ok: false,
          code: 'LISTING_NOT_PAID',
          message: 'This listing is free-with-attribution and cannot be bought as a placement.',
        };
      }
      // The campaign cap is checked before status: a listing only reaches
      // 'exhausted' by filling its campaign budget, and that is a different
      // answer for an advertiser ("this campaign is finished") than a supplier
      // pulling their creative ("come back later").
      const campaignCap = parseUsdc(listing.budgetCapUsdc);
      const campaignSpent = parseUsdc(listing.budgetSpentUsdc) ?? 0n;
      if (listing.status === 'exhausted' || (campaignCap !== null && campaignSpent >= campaignCap)) {
        return {
          ok: false,
          code: 'CAMPAIGN_EXHAUSTED',
          message: 'This listing has reached its campaign budget and is not accepting new placements.',
        };
      }
      if (listing.status !== 'active') {
        return {
          ok: false,
          code: 'LISTING_NOT_SERVABLE',
          message: `This listing is ${listing.status} and is not accepting new placements.`,
        };
      }

      const [channel] = await db
        .select()
        .from(channelsTable)
        .where(eq(channelsTable.id, channelId))
        .limit(1);
      // Someone else's channel is reported missing, not forbidden.
      if (!channel || channel.ownerWallet.toLowerCase() !== wallet) {
        return { ok: false, code: 'CHANNEL_NOT_FOUND', message: 'Channel not found.' };
      }
      // THE fraud gate. Unverified reach cannot buy inventory, because the
      // supplier is being paid for distribution that has not been proven.
      if (!canBuySlots(channel)) {
        return {
          ok: false,
          code: 'CHANNEL_UNVERIFIED',
          message:
            channel.status !== 'active'
              ? 'This channel is suspended and cannot buy placements.'
              : 'Verify a distribution surface before buying a placement. Self-reported reach is not accepted.',
        };
      }

      const model: PricingModel = listing.pricing.model;
      const flatFee = model === 'flat' ? (listing.pricing.flatFeeUsdc ?? null) : null;
      const cpm = model === 'cpm' ? (listing.pricing.cpmUsdc ?? null) : null;
      const flatMicro = parseUsdc(flatFee);
      const cpmMicro = parseUsdc(cpm);
      if (model === 'flat' && (flatMicro === null || flatMicro <= 0n)) {
        return { ok: false, code: 'PRICING_MISMATCH', message: 'This listing has no flat fee set.' };
      }
      if (model === 'cpm' && (cpmMicro === null || cpmMicro <= 0n)) {
        return { ok: false, code: 'PRICING_MISMATCH', message: 'This listing has no CPM rate set.' };
      }

      const budgetProvided = budgetUsdc !== null && budgetUsdc !== undefined && String(budgetUsdc).trim() !== '';
      const budget = parseUsdc(budgetUsdc);
      if (budgetProvided && budget === null) {
        return { ok: false, code: 'INVALID_BUDGET', message: 'Budget must be a non-negative decimal USDC amount.' };
      }
      // CPM spends as it serves, so the escrow IS the price. Without it there
      // is nothing to draw down and no ceiling on delivery.
      if (model === 'cpm' && (budget === null || budget <= 0n)) {
        return {
          ok: false,
          code: budget === null ? 'BUDGET_REQUIRED' : 'INVALID_BUDGET',
          message:
            budget === null
              ? 'A CPM placement needs a budget — it is the amount escrowed and the ceiling on delivery.'
              : 'A CPM budget must be greater than zero.',
        };
      }
      if (model === 'flat' && budget !== null && flatMicro !== null && budget < flatMicro) {
        return {
          ok: false,
          code: 'BUDGET_BELOW_FEE',
          message: 'The budget is below the flat fee for this listing.',
        };
      }
      // A campaign cap also bounds an individual slot. Without this clamp a
      // buyer could escrow more than the supplier's whole remaining campaign,
      // and `accrue` would then refuse delivery the buyer had already paid for.
      const campaignHeadroom = campaignCap !== null ? campaignCap - campaignSpent : null;
      // A flat fee larger than the campaign's remaining budget could never be
      // paid, so refuse now rather than hand back a slot that fails at checkout.
      if (model === 'flat' && flatMicro !== null && campaignHeadroom !== null && flatMicro > campaignHeadroom) {
        return {
          ok: false,
          code: 'CAMPAIGN_EXHAUSTED',
          message: 'This listing does not have enough campaign budget left for another flat-fee placement.',
        };
      }
      const effectiveBudget =
        budget !== null && campaignHeadroom !== null && budget > campaignHeadroom
          ? campaignHeadroom
          : budget;
      if (model === 'cpm' && effectiveBudget !== null && effectiveBudget <= 0n) {
        return {
          ok: false,
          code: 'CAMPAIGN_EXHAUSTED',
          message: 'This listing has reached its campaign budget and is not accepting new placements.',
        };
      }

      const code = newTrackingCode();
      const now = new Date();
      try {
        const [row] = await db
          .insert(slotsTable)
          .values({
            id: randomUUID(),
            listingId,
            channelId,
            buyerWallet: wallet,
            pricingModel: model,
            flatFeeUsdc: flatFee,
            cpmUsdc: cpm,
            budgetUsdc: effectiveBudget === null ? null : fromMicroUsdc(effectiveBudget),
            spentUsdc: '0',
            impressionsDelivered: 0,
            clicksDelivered: 0,
            trackingCode: code,
            trackingUrl: trackingUrl(code),
            // Copied from the listing rather than referenced: the served
            // creative must keep its disclosure even if the supplier later
            // edits or pauses the listing.
            disclosure: listing.disclosure ?? {
              kind: 'sponsored',
              label: '#ad',
              statement: 'Sponsored placement arranged through VERSIONS.',
            },
            attributionText: listing.attributionText,
            status: 'pending_payment',
            paymentMock: false,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return { ok: true, slot: rowToSlot(row, listing) };
      } catch (err) {
        // uq_slots_active_listing_channel allows one live slot per (listing,
        // channel). Returning the existing row makes a double-click idempotent
        // and never mints a second tracking code for the same placement.
        const [existing] = await db
          .select(slotWithListing)
          .from(slotsTable)
          .innerJoin(listingsTable, eq(slotsTable.listingId, listingsTable.id))
          .where(and(eq(slotsTable.listingId, listingId), eq(slotsTable.channelId, channelId)))
          .limit(1);
        if (existing) {
          return { ok: true, slot: rowToSlot(existing.slot, existing.listing), alreadyExisted: true };
        }
        throw err;
      }
    },

    async pay(slotId, buyerWallet) {
      const found = await loadOwned(slotId, buyerWallet);
      if ('error' in found) return found.error;
      const { slot, listing } = found;

      if (slot.status !== 'pending_payment') {
        return {
          ok: false,
          code: 'SLOT_NOT_PAYABLE',
          message:
            slot.status === 'active' || slot.status === 'completed'
              ? 'This placement is already paid.'
              : `This placement is ${slot.status} and cannot be paid.`,
        };
      }
      // Fail-closed claim: one caller only, and a payment that throws leaves
      // the lease held rather than reopening a slot that may have been charged.
      const leaseId = randomUUID();
      const [claimed] = await db
        .update(slotsTable)
        .set({ settlementLeaseId: leaseId, updatedAt: new Date() })
        .where(
          and(
            eq(slotsTable.id, slotId),
            eq(slotsTable.status, 'pending_payment'),
            isNull(slotsTable.settlementLeaseId),
          ),
        )
        .returning();
      if (!claimed) {
        return {
          ok: false,
          code: 'SETTLEMENT_IN_PROGRESS',
          message: 'This placement is already being paid for.',
        };
      }

      const isFlat = slot.pricingModel === 'flat';
      // Flat fee is the price of the placement. CPM escrows the budget and
      // settles only what it actually serves.
      const charge = isFlat ? (slot.flatFeeUsdc ?? '0') : (slot.budgetUsdc ?? '0');
      const chargeMicro = parseUsdc(charge) ?? 0n;
      if (chargeMicro <= 0n) {
        return { ok: false, code: 'PRICING_MISMATCH', message: 'This placement has no amount to collect.' };
      }
      // Reserve against the supplier's campaign BEFORE any money moves, with
      // the cap test inside the same statement as the increment. Reading the
      // counter here instead would let two CPM slots both see the same
      // headroom and both escrow it.
      if (!(await moveCampaignSpend(listing.id, chargeMicro))) {
        await db
          .update(slotsTable)
          .set({ settlementLeaseId: null, updatedAt: new Date() })
          .where(and(eq(slotsTable.id, slotId), eq(slotsTable.settlementLeaseId, leaseId)));
        return {
          ok: false,
          code: 'CAMPAIGN_EXHAUSTED',
          message: 'This listing has reached its campaign budget and cannot take another placement.',
        };
      }

      try {
        const tx = await transfer(slot.buyerWallet, platformWallet || '', charge);
        let legs: SlotLegRecord[] = [];
        // A flat-fee placement is delivered in full the moment it is paid, so
        // its spend is the fee. CPM starts at zero and accrues per impression.
        const spent = isFlat ? charge : '0';
        if (isFlat) {
          legs = await settleGross(slotId, charge, listing.supplierWallet, slot.buyerWallet);
        }

        const now = new Date();
        const [paid] = await db
          .update(slotsTable)
          .set({
            status: 'active',
            paymentTxHash: tx.hash,
            paymentMock: tx.mock,
            spentUsdc: spent,
            settlementLeaseId: null,
            settledAt: isFlat ? now : null,
            updatedAt: now,
          })
          .where(and(eq(slotsTable.id, slotId), eq(slotsTable.settlementLeaseId, leaseId)))
          .returning();
        if (!paid) {
          return {
            ok: false,
            code: 'SETTLEMENT_CLAIM_LOST',
            message: 'Payment completed externally but its lease is no longer active. Reconciliation is required.',
          };
        }

        const record = rowToSlot(paid, listing);
        const timestamp = now.toISOString();
        if (!isFlat) {
          // A flat-fee payment is already on the receipt stream three times
          // over — settleSlotLegsAsync emits one durable event per leg, and
          // emitting a summary here would double-count the same money.
          // The CPM escrow has no legs yet, so it is the only receipt.
          await emitDurable('settlement-event', {
            type: 'settled',
            source: 'slot',
            settlementId: slotId,
            slotId,
            toWallet: platformWallet || undefined,
            tipperWallet: slot.buyerWallet,
            amountUsdc: charge,
            txHash: tx.hash,
            mock: tx.mock,
            title: listing.title,
            artistName: listing.supplierName,
            timestamp,
          });
          emit('economy-event', {
            kind: 'slot_leg_settled',
            settlementId: slotId,
            slotId,
            title: listing.title,
            artistName: listing.supplierName,
            toWallet: platformWallet || undefined,
            fromWallet: slot.buyerWallet,
            amountUsdc: charge,
            txHash: tx.hash,
            mock: tx.mock,
            timestamp,
          });
        }

        return { ok: true, slot: record, charged_usdc: charge, tx_hash: tx.hash, mock: tx.mock, legs };
      } catch (err) {
        // Money may already have left the buyer. Leave the lease held so a
        // retry cannot charge the same slot twice.
        log.error('slot payment failed — lease held for reconciliation', {
          slot_id: slotId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          code: 'PAYMENT_FAILED',
          message: 'Payment could not be completed. The placement is held for reconciliation.',
        };
      }
    },

    async accrue({ slotId, impressions = 0, clicks = 0 }) {
      const found = await loadSlot(slotId);
      if (!found) return { ok: false, code: 'SLOT_NOT_FOUND', message: 'Slot not found.' };
      const { slot, listing } = found;
      const notActive = (status: SlotStatus): AccrueOutcome => ({
        ok: false,
        code: 'SLOT_NOT_ACTIVE',
        message: `This placement is ${status}; delivery does not count against it.`,
      });
      if (slot.status === 'exhausted') {
        return {
          ok: false,
          code: 'BUDGET_EXHAUSTED',
          message: 'This placement has reached its budget cap and stopped serving.',
        };
      }
      if (slot.status !== SERVABLE) return notActive(slot.status);

      const imps = Math.max(0, Math.floor(impressions));
      const clks = Math.max(0, Math.floor(clicks));
      if (imps === 0 && clks === 0) {
        return { ok: true, slot: rowToSlot(slot, listing), delta_usdc: '0', exhausted: false };
      }

      // CPM spends per thousand impressions in integer micro-USDC, so a
      // fractional impression can never round money into existence. A
      // flat-fee slot was paid in full at purchase: its counters move, its
      // spend does not.
      const cpmMicro = slot.pricingModel === 'cpm' ? (parseUsdc(slot.cpmUsdc) ?? 0n) : 0n;
      const deltaMicro = (BigInt(imps) * cpmMicro) / 1000n;
      const delta = fromMicroUsdc(deltaMicro);

      const spent = sql`(CAST(${slotsTable.spentUsdc} AS NUMERIC) + CAST(${delta} AS NUMERIC))`;
      const cap = sql`CAST(${slotsTable.budgetUsdc} AS NUMERIC)`;

      // THE delivery cap. The ceiling test is in the WHERE clause of the same
      // statement that increments, so two concurrent events cannot both read
      // "under budget" and then both write.
      const [moved] = await db
        .update(slotsTable)
        .set({
          spentUsdc: sql`${spent}::TEXT`,
          impressionsDelivered: sql`${slotsTable.impressionsDelivered} + ${imps}`,
          clicksDelivered: sql`${slotsTable.clicksDelivered} + ${clks}`,
          status: sql`CASE
              WHEN ${slotsTable.budgetUsdc} IS NOT NULL AND ${spent} >= ${cap}
              THEN 'exhausted'
              ELSE ${slotsTable.status}
            END`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(slotsTable.id, slotId),
            eq(slotsTable.status, SERVABLE),
            sql`(${slotsTable.budgetUsdc} IS NULL OR ${spent} <= ${cap})`,
          ),
        )
        .returning();

      if (!moved) {
        const current = await loadSlot(slotId);
        if (!current) return { ok: false, code: 'SLOT_NOT_FOUND', message: 'Slot not found.' };
        if (current.slot.status !== SERVABLE) return notActive(current.slot.status);
        return {
          ok: false,
          code: 'BUDGET_EXHAUSTED',
          message: 'This placement has reached its budget cap and stopped serving.',
        };
      }

      const record = rowToSlot(moved, listing);
      return {
        ok: true,
        slot: record,
        delta_usdc: delta,
        exhausted: moved.status === 'exhausted',
      };
    },

    async complete(slotId, buyerWallet) {
      const found = await loadOwned(slotId, buyerWallet);
      if ('error' in found) return found.error;
      const { slot, listing } = found;

      const settledSoFar = async (): Promise<SlotLegRecord[]> =>
        legRecords(await settlement.getLegsForSlot(slotId));

      if (slot.status === 'completed') {
        return {
          ok: true,
          slot: rowToSlot(slot, listing),
          charged_usdc: slot.spentUsdc,
          tx_hash: slot.paymentTxHash,
          mock: slot.paymentMock,
          legs: await settledSoFar(),
        };
      }
      if (slot.status !== 'active' && slot.status !== 'exhausted' && slot.status !== 'paused') {
        return {
          ok: false,
          code: 'SLOT_NOT_PAYABLE',
          message: `This placement is ${slot.status} and cannot be completed.`,
        };
      }

      const leaseId = randomUUID();
      const [claimed] = await db
        .update(slotsTable)
        .set({ settlementLeaseId: leaseId, updatedAt: new Date() })
        .where(and(eq(slotsTable.id, slotId), isNull(slotsTable.settlementLeaseId)))
        .returning();
      if (!claimed) {
        return {
          ok: false,
          code: 'SETTLEMENT_IN_PROGRESS',
          message: 'This placement is already being settled.',
        };
      }

      const isCpm = slot.pricingModel === 'cpm';
      const spentMicro = parseUsdc(slot.spentUsdc) ?? 0n;
      const escrowMicro = isCpm ? (parseUsdc(slot.budgetUsdc) ?? 0n) : 0n;
      // A CPM slot escrowed its budget up front and drew it down as it served.
      // Completing settles what it actually spent and returns the rest:
      // keeping the balance would be charging for impressions that never ran.
      const refundMicro = escrowMicro > spentMicro ? escrowMicro - spentMicro : 0n;

      try {
        let legs: SlotLegRecord[] = [];
        if (isCpm && spentMicro > 0n) {
          legs = await settleGross(slotId, fromMicroUsdc(spentMicro), listing.supplierWallet, slot.buyerWallet);
        } else {
          legs = await settledSoFar();
        }

        const refund =
          refundMicro > 0n
            ? await transfer(platformWallet || '', slot.buyerWallet, fromMicroUsdc(refundMicro))
            : { hash: null, mock: slot.paymentMock };
        if (refundMicro > 0n) {
          await releaseCampaignSpend(listing.id, refundMicro);
        }

        const now = new Date();
        const [done] = await db
          .update(slotsTable)
          .set({
            status: 'completed',
            settlementLeaseId: null,
            settledAt: now,
            paymentMock: slot.paymentMock || refund.mock,
            updatedAt: now,
          })
          .where(and(eq(slotsTable.id, slotId), eq(slotsTable.settlementLeaseId, leaseId)))
          .returning();
        if (!done) {
          return {
            ok: false,
            code: 'SETTLEMENT_CLAIM_LOST',
            message: 'Settlement completed externally but its lease is no longer active. Reconciliation is required.',
          };
        }

        const record = rowToSlot(done, listing);
        const timestamp = now.toISOString();
        if (refundMicro > 0n) {
          // The settled spend is already on the receipt stream once per leg.
          // The refund is the only money here that no leg covers, and it is
          // the receipt that proves the buyer was not charged for undelivered
          // impressions.
          await emitDurable('settlement-event', {
            type: 'settled',
            source: 'slot',
            settlementId: slotId,
            slotId,
            toWallet: slot.buyerWallet,
            tipperWallet: platformWallet || undefined,
            amountUsdc: fromMicroUsdc(refundMicro),
            txHash: refund.hash,
            mock: refund.mock,
            title: listing.title,
            artistName: listing.supplierName,
            timestamp,
          });
          emit('economy-event', {
            kind: 'slot_leg_settled',
            settlementId: slotId,
            slotId,
            title: listing.title,
            artistName: listing.supplierName,
            toWallet: slot.buyerWallet,
            fromWallet: platformWallet || undefined,
            amountUsdc: fromMicroUsdc(refundMicro),
            txHash: refund.hash,
            mock: refund.mock,
            timestamp,
          });
        }

        return {
          ok: true,
          slot: record,
          charged_usdc: fromMicroUsdc(spentMicro),
          tx_hash: refund.hash ?? slot.paymentTxHash,
          mock: refund.mock,
          legs,
        };
      } catch (err) {
        log.error('slot completion failed — lease held for reconciliation', {
          slot_id: slotId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          ok: false,
          code: 'PAYMENT_FAILED',
          message: 'Settlement could not be completed. The placement is held for reconciliation.',
        };
      }
    },

    async pause(slotId, wallet) {
      return setStatus(slotId, wallet, 'paused', [SERVABLE]);
    },

    async resume(slotId, wallet) {
      // An exhausted slot cannot be resumed: there is no budget left to serve
      // against, and re-activating it would show a live placement whose every
      // delivery event the cap guard refuses.
      return setStatus(slotId, wallet, SERVABLE, ['paused']);
    },

    async get(slotId) {
      const found = await loadSlot(slotId);
      return found ? rowToSlot(found.slot, found.listing) : null;
    },

    async getByTrackingCode(code) {
      const [row] = await db
        .select(slotWithListing)
        .from(slotsTable)
        .innerJoin(listingsTable, eq(slotsTable.listingId, listingsTable.id))
        .where(eq(slotsTable.trackingCode, code))
        .limit(1);
      return row ? rowToSlot(row.slot, row.listing) : null;
    },

    async listForChannel(channelId, { limit = 50 } = {}) {
      return listSlots(eq(slotsTable.channelId, channelId), limit);
    },

    async listForListing(listingId, { limit = 50 } = {}) {
      return listSlots(eq(slotsTable.listingId, listingId), limit);
    },

    async listForBuyer(wallet, { limit = 50 } = {}) {
      return listSlots(eq(slotsTable.buyerWallet, wallet.toLowerCase()), limit);
    },

    async legs(slotId) {
      const rows = await db
        .select()
        .from(slotLegsTable)
        .where(eq(slotLegsTable.slotId, slotId));
      return legRecords(rows);
    },
  };
}
