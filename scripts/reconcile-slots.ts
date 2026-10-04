// MODULAR: slot reconciliation report. READ-ONLY.
//
// `slots.pay()` deliberately leaves a slot's settlement lease HELD when
// payment throws, rather than reopening a slot that may already have been
// charged (src/services/slots.ts). That is the right call — the alternative
// risks double-charging — but it means recovery is manual SQL. This script is
// that first step: it lists every slot in an ambiguous state, with the evidence
// needed to decide what happened.
//
// It never writes. There is deliberately no `--fix` flag: resolving an
// ambiguous money state is a human decision against a chain explorer, not
// something a script should be able to do by accident.
//
// What it reports:
//   • lease held        — pay() claimed the slot and never released it
//   • paid, no legs     — flat-fee money moved but the 3-leg split is missing
//   • paid, short legs   — fewer than EXPECTED_SLOT_LEG_COUNT legs
//   • pending, aged      — reserved but never paid (abandoned checkout)
//
// Run:  npm run reconcile:slots
//      DATABASE_URL=... npm run reconcile:slots
//
// Exit code is always 0 — this is a report, not a gate.

import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { slots as slotsTable, slotLegs as slotLegsTable } from '../src/lib/schema';
import { EXPECTED_SLOT_LEG_COUNT } from '../src/services/settlement';

const AGED_PENDING_HOURS = 24;

interface LegCount {
  slotId: string;
  count: number;
  settled: number;
}

async function legCounts(): Promise<Map<string, LegCount>> {
  const rows = await db
    .select({
      slotId: slotLegsTable.slotId,
      count: sql<number>`count(*)::int`,
      // `status` unqualified is ambiguous here — slots.status is in scope via
      // the later queries' shape and Postgres rejects it in the FILTER.
      settled: sql<number>`count(*) filter (where ${slotLegsTable.status} = 'settled')::int`,
    })
    .from(slotLegsTable)
    .groupBy(slotLegsTable.slotId);

  const map = new Map<string, LegCount>();
  for (const r of rows) {
    map.set(r.slotId, { slotId: r.slotId, count: Number(r.count), settled: Number(r.settled) });
  }
  return map;
}

async function main() {
  console.log('── VERSIONS slot reconciliation (read-only) ──────────────\n');

  const legs = await legCounts();
  let flagged = 0;

  // 1. A held lease with the slot still pending_payment: pay() was interrupted
  //    before it could flip the status. Money may or may not have moved.
  const leased = await db
    .select()
    .from(slotsTable)
    .where(isNotNull(slotsTable.settlementLeaseId));
  for (const slot of leased) {
    flagged += 1;
    const leg = legs.get(slot.id);
    console.log('  LEASE HELD — recovery required');
    console.log(`    slot_id:        ${slot.id}`);
    console.log(`    listing_id:     ${slot.listingId}`);
    console.log(`    channel_id:     ${slot.channelId}`);
    console.log(`    status:         ${slot.status}`);
    console.log(`    payment_tx:     ${slot.paymentTxHash ?? '(none recorded)'}`);
    console.log(`    payment_mock:   ${slot.paymentMock}`);
    console.log(`    spent_usdc:     ${slot.spentUsdc}`);
    console.log(`    legs:           ${leg?.count ?? 0} (expected ${EXPECTED_SLOT_LEG_COUNT})`);
    console.log(`    updated_at:     ${slot.updatedAt.toISOString()}`);
    console.log('    next:           compare payment_tx against the Arc explorer before changing anything');
    console.log('');
  }

  // 2. Paid money without a complete split. Only reachable if the leg insert
  //    failed after the transfer, which is exactly the SETTLEMENT_CLAIM_LOST
  //    path.
  const paid = await db
    .select()
    .from(slotsTable)
    .where(sql`${slotsTable.paymentTxHash} IS NOT NULL OR ${slotsTable.spentUsdc} <> '0'`);
  for (const slot of paid) {
    const leg = legs.get(slot.id);
    const count = leg?.count ?? 0;
    if (count >= EXPECTED_SLOT_LEG_COUNT) continue;
    flagged += 1;
    console.log('  INCOMPLETE SPLIT — money moved, legs missing');
    console.log(`    slot_id:        ${slot.id}`);
    console.log(`    status:         ${slot.status}`);
    console.log(`    spent_usdc:     ${slot.spentUsdc}`);
    console.log(`    legs:           ${count} of ${EXPECTED_SLOT_LEG_COUNT}`);
    console.log('    next:           confirm the transfer settled on chain, then re-derive the missing legs');
    console.log('');
  }

  // 3. Reserved but never paid — an abandoned checkout, not an incident, but
  //    worth surfacing because it holds campaign budget headroom.
  const cutoff = new Date(Date.now() - AGED_PENDING_HOURS * 3_600_000);
  const abandoned = await db
    .select()
    .from(slotsTable)
    .where(and(eq(slotsTable.status, 'pending_payment'), isNull(slotsTable.settlementLeaseId), lt(slotsTable.createdAt, cutoff)));
  for (const slot of abandoned) {
    flagged += 1;
    console.log('  ABANDONED CHECKOUT — reserved, never paid');
    console.log(`    slot_id:        ${slot.id}`);
    console.log(`    listing_id:     ${slot.listingId}`);
    console.log(`    created_at:     ${slot.createdAt.toISOString()}`);
    console.log('    next:           safe to cancel once confirmed abandoned');
    console.log('');
  }

  if (flagged === 0) {
    console.log('  No slots need reconciliation. Every paid slot has a complete split.\n');
  } else {
    console.log(`  ${flagged} slot(s) listed above. Nothing was modified.\n`);
  }
  console.log('  This script is read-only by design. It never writes and never retries a payment.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('reconciliation failed:', err instanceof Error ? err.message : err);
    process.exit(0);
  });
