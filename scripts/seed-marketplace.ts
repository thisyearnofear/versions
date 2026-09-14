// MODULAR: Beachhead marketplace seed — the slice to win first.
//
// Calls the SERVICE layer directly (no HTTP) so it works both locally
// and in CI (PGlite tests). Also works against a real DB via DATABASE_URL.
//
// Beachhead niche: "lo-fi night drive / study / focus" — one ethos where
// music + placements already rhyme, not the whole catalog. Supply +
// demand together: 30-50 listings across both catalogs, 3-5 verified
// channels (mock-verified in CI), 1 paid slot + usage proof so the paid
// side is sellable before the first advertiser asks.
//
// Run:
//   npx tsx scripts/seed-marketplace.ts          # local DB (DATABASE_URL or .env)
//   DATABASE_URL=postgres://... npx tsx scripts/seed-marketplace.ts
//   npm run seed:marketplace                      # via package.json script

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { users as usersTable, submissions as submissionsTable } from '../src/lib/schema';
import { AGREEMENT_VERSION } from '../src/lib/agreement';
import { createListingsService } from '../src/services/listings';
import { createChannelsService } from '../src/services/channels';
import { createSlotsService } from '../src/services/slots';
import { createUsageService } from '../src/services/usage';
import { createSettlementService } from '../src/services/settlement';
import { createArcAdapter } from '../src/adapters/arc';
import { createChannelProbeAdapter } from '../src/adapters/youtube';
import { createEmbeddingService } from '../src/services/embeddings';

// ── Identities (deterministic, distinct from seed-catalog.ts artist) ──
const WALLETS = {
  supplierMusic: '0x' + 'c'.repeat(40),
  supplierBrand: '0x' + 'd'.repeat(40),
  channelOwner: '0x' + 'e'.repeat(40),
  buyer: '0x' + 'e'.repeat(40), // same as channelOwner so the channel can buy
  platform: process.env.PLATFORM_WALLET || '0x' + 'a'.repeat(40),
};

// ── Beachhead tags (tight, discriminating) ──
const NICHE_TAGS = ['lo-fi', 'night drive', 'study', 'focus', 'midnight', 'chill', 'analog', 'ambient'];

type SeedListing = {
  kind: 'music' | 'placement';
  title: string;
  supplierName: string;
  summary: string;
  tags: string[];
  tier: 'free' | 'paid';
  pricing?: { model: 'flat'; flatFeeUsdc: string } | { model: 'cpm'; cpmUsdc: string };
  images?: string[];
  submissionId?: string;
  budgetCapUsdc?: string;
};

// 18 music listings (half free, half paid) — titles + tags target the niche
const MUSIC_LISTINGS: SeedListing[] = [
  { kind: 'music', title: 'Midnight Study Session', supplierName: 'Luna Rivera', summary: 'Lo-fi tape loop for late-night focus. 84 bpm, vinyl crackle, no vocals.', tags: ['lo-fi','study','focus','night drive','analog'], tier: 'free' },
  { kind: 'music', title: 'Neon After Hours', supplierName: 'The Night Shift', summary: 'Synthwave-tinted lo-fi, steady pulse for night driving.', tags: ['lo-fi','night drive','midnight','chill','synth'], tier: 'free' },
  { kind: 'music', title: 'Paper Lanterns', supplierName: 'Paper Birds', summary: 'Fingerpicked guitar + soft pad, sunrise focus.', tags: ['ambient','study','focus','acoustic','chill'], tier: 'free' },
  { kind: 'music', title: 'Static & Velvet', supplierName: 'Kaya Moon', summary: 'Tape-warped soul, low-slung groove, midnight vibe.', tags: ['lo-fi','midnight','chill','analog','soul'], tier: 'free' },
  { kind: 'music', title: 'Dustlight', supplierName: 'The Wandering Folk', summary: 'Americana-tinged ambient, open road, dusk.', tags: ['ambient','night drive','analog','focus','chill'], tier: 'free' },
  { kind: 'music', title: 'Glass Harbor', supplierName: 'Paper Birds', summary: 'Bright acoustic, hopeful morning — paired focus.', tags: ['study','focus','ambient','acoustic','chill'], tier: 'free' },
  { kind: 'music', title: 'Chrome Memory', supplierName: 'The Night Shift', summary: 'Gated reverb + analog synth, gated nostalgia.', tags: ['night drive','midnight','analog','lo-fi','synth'], tier: 'free' },
  { kind: 'music', title: 'Autumn Signal', supplierName: 'Luna Rivera', summary: 'Intimate folk, warm room, quiet reveal.', tags: ['ambient','study','focus','analog','intimate'], tier: 'free' },
  { kind: 'music', title: 'Neon Study Club', supplierName: 'The Night Shift', summary: 'Paid tier: same ethos, premium master, cleared for monetized use.', tags: ['lo-fi','study','night drive','focus','premium'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '25' } },
  { kind: 'music', title: 'After Midnight (master)', supplierName: 'Kaya Moon', summary: 'R&B lo-fi, late-night focus, disclosure baked in.', tags: ['lo-fi','midnight','study','chill','r&b'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '4.50' }, budgetCapUsdc: '200' },
  { kind: 'music', title: 'Highway Hypnosis', supplierName: 'Luna Rivera', summary: 'Hypnotic drive pulse, CPM billed.', tags: ['night drive','focus','ambient','lo-fi','highway'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '3.00' }, budgetCapUsdc: '150' },
  { kind: 'music', title: 'Study Bloom', supplierName: 'Paper Birds', summary: 'Acoustic bloom, paid placement with budget cap.', tags: ['study','focus','ambient','acoustic','chill'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '18' }, budgetCapUsdc: '180' },
  { kind: 'music', title: 'Analog Drift', supplierName: 'The Wandering Folk', summary: 'Live room drift, analog warmth.', tags: ['analog','ambient','night drive','lo-fi','live room'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '12' } },
  { kind: 'music', title: 'Velvet Night Drive', supplierName: 'Kaya Moon', summary: 'Slow-burn soul for night drive, paid.', tags: ['night drive','midnight','lo-fi','chill','soul'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '5.00' }, budgetCapUsdc: '300' },
  { kind: 'music', title: 'Focus Current', supplierName: 'Luna Rivera', summary: 'Lock-groove focus, no vocals.', tags: ['focus','study','lo-fi','ambient','minimal'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '15' } },
  { kind: 'music', title: 'Midnight Bloom (alt)', supplierName: 'Paper Birds', summary: 'Alternate take, same ethos, different texture.', tags: ['study','focus','ambient','chill','acoustic'], tier: 'free' },
  { kind: 'music', title: 'Static Horizon', supplierName: 'The Night Shift', summary: 'Retro-tech drift, night drive tension release.', tags: ['night drive','midnight','synth','lo-fi','analog'], tier: 'free' },
  { kind: 'music', title: 'Quiet Hours', supplierName: 'The Wandering Folk', summary: 'Earnest quiet, study floor, no drums.', tags: ['study','focus','ambient','analog','quiet'], tier: 'free' },
];

// 14 placement listings — brand/product with ethos-matched tags
const PLACEMENT_LISTINGS: SeedListing[] = [
  { kind: 'placement', title: 'Coldbrew Co — Night Shift Roast', supplierName: 'Coldbrew Co', summary: 'Coffee for the midnight session. Cold, weekly.', tags: ['coffee','night drive','study','midnight','focus'], tier: 'free', images: ['https://picsum.photos/seed/coldbrew-night/600/400'] },
  { kind: 'placement', title: 'Focus Fuel — Study Chews', supplierName: 'Focus Fuel', summary: 'Chews for deep work. Subtle, sustained.', tags: ['study','focus','wellness','chill','productivity'], tier: 'free', images: ['https://picsum.photos/seed/focus-fuel/600/400'] },
  { kind: 'placement', title: 'Analog Hours — Cassette Club', supplierName: 'Analog Hours', summary: 'Monthly tape club. Lo-fi, physical, slow.', tags: ['analog','lo-fi','study','midnight','music gear'], tier: 'free', images: ['https://picsum.photos/seed/analog-hours/600/400'] },
  { kind: 'placement', title: 'Night Drive Sunglasses', supplierName: 'Noir Optics', summary: 'Anti-glare for the after-hours drive.', tags: ['night drive','midnight','style','analog','accessories'], tier: 'free', images: ['https://picsum.photos/seed/noir-optics/600/400'] },
  { kind: 'placement', title: 'Loop & Drift — Headphones', supplierName: 'Loop & Drift', summary: 'Closed-back, warm, non-fatiguing.', tags: ['lo-fi','study','focus','audio','gear'], tier: 'free', images: ['https://picsum.photos/seed/loop-drift/600/400'] },
  { kind: 'placement', title: 'Paper & Thread — Notebooks', supplierName: 'Paper & Thread', summary: 'Dot grid, 120gsm, for the study desk.', tags: ['study','focus','analog','stationery','chill'], tier: 'free', images: ['https://picsum.photos/seed/paper-thread/600/400'] },
  { kind: 'placement', title: 'Coldbrew Co — Sponsor Slot', supplierName: 'Coldbrew Co', summary: 'Sponsored: the study-stream roast. #ad disclosure included.', tags: ['coffee','study','focus','night drive','sponsor'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '6.00' }, images: ['https://picsum.photos/seed/coldbrew-sponsor/600/400'], budgetCapUsdc: '250' },
  { kind: 'placement', title: 'Focus Fuel — Sponsor Slot', supplierName: 'Focus Fuel', summary: 'Sponsored: study chews — paid promotion.', tags: ['study','focus','sponsor','wellness','paid'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '40' }, images: ['https://picsum.photos/seed/focus-sponsor/600/400'], budgetCapUsdc: '400' },
  { kind: 'placement', title: 'Analog Hours — Paid Drop', supplierName: 'Analog Hours', summary: 'Paid drop for tape heads. Budget-capped.', tags: ['analog','lo-fi','midnight','sponsor','music gear'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '5.50' }, images: ['https://picsum.photos/seed/analog-paid/600/400'], budgetCapUsdc: '180' },
  { kind: 'placement', title: 'Noir Optics — Night Pack', supplierName: 'Noir Optics', summary: 'Paid: the night-drive pack.', tags: ['night drive','midnight','sponsor','style','accessories'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '30' }, images: ['https://picsum.photos/seed/noir-paid/600/400'] },
  { kind: 'placement', title: 'Loop & Drift — Studio Line', supplierName: 'Loop & Drift', summary: 'Studio line, paid slot.', tags: ['audio','study','focus','sponsor','gear'], tier: 'paid', pricing: { model: 'cpm', cpmUsdc: '4.00' }, images: ['https://picsum.photos/seed/loop-paid/600/400'], budgetCapUsdc: '200' },
  { kind: 'placement', title: 'Paper & Thread — Desk Set', supplierName: 'Paper & Thread', summary: 'Desk set bundle, free with attribution.', tags: ['study','focus','stationery','analog','desk'], tier: 'free', images: ['https://picsum.photos/seed/paper-desk/600/400'] },
  { kind: 'placement', title: 'Midnight Tea Co', supplierName: 'Midnight Tea Co', summary: 'Caffeine-free focus tea for the late session.', tags: ['study','midnight','focus','wellness','chill'], tier: 'free', images: ['https://picsum.photos/seed/midnight-tea/600/400'] },
  { kind: 'placement', title: 'Signal — Focus App', supplierName: 'Signal', summary: 'Distraction-free timer. Study companion.', tags: ['study','focus','productivity','app','chill'], tier: 'paid', pricing: { model: 'flat', flatFeeUsdc: '22' }, images: ['https://picsum.photos/seed/signal-app/600/400'] },
];

const CHANNEL_DEFS = [
  { url: 'https://www.youtube.com/@lofi-night-drive', niche: 'lo-fi night drive / study streams', ethos: '12-hour lo-fi night drive streams, study-with-me loops, analog tape visuals, midnight focus sessions' },
  { url: 'https://www.youtube.com/@midnight-study-club', niche: 'study & focus', ethos: 'Study vlogs, pomodoro sessions, ambient room tones, lo-fi beats for deep work' },
  { url: 'https://www.youtube.com/@analog-hours', niche: 'analog & ambient', ethos: 'Analog gear demos, tape loops, ambient textures, chill room recordings' },
  { url: 'https://www.youtube.com/channel/UC1234567890123456789012', niche: 'night drive radio', ethos: 'Night drive radio, highway ambient, synthwave at midnight, city lights' },
];

async function ensureUser(wallet: string, name: string) {
  await db.insert(usersTable).values({ id: randomUUID(), walletAddress: wallet, displayName: name }).onConflictDoNothing({ target: usersTable.walletAddress });
}

function makeSilentSubmission(id: string, wallet: string, title: string, artist: string): typeof submissionsTable.$inferInsert {
  return {
    id,
    artistWallet: wallet,
    title,
    artistName: artist,
    versionType: 'studio',
    genre: 'lo-fi',
    artistMood: 'chill',
    description: `Seed track for ${title}`,
    audioPath: `data/uploads/seed-${id}.mp3`,
    audioDurationSeconds: 180,
    audioSizeBytes: 2048,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    status: 'published',
    coverSvg: `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\"><rect width=\"100%\" height=\"100%\" fill=\"#1a1a2e\"/><text x=\"50%\" y=\"50%\" text-anchor=\"middle\" dy=\".3em\" fill=\"#eee\" font-size=\"10\">${title.slice(0,12)}</text></svg>`,
    audioFeatures: { tempo: 84, key: 'Am', energy: 0.3, danceability: 0.4, acousticness: 0.7, loudness: -14, instrumentalness: 0.9, valence: 0.4 } as never,
  };
}

async function main() {
  console.log('🌱 Beachhead marketplace seed — lo-fi night drive / study / focus\n');

  const listingsSvc = createListingsService();
  const channelProbe = createChannelProbeAdapter();
  const channelsSvc = createChannelsService(channelProbe);
  const arc = createArcAdapter();
  const settlement = createSettlementService({ arc: arc as never, platformWallet: WALLETS.platform });
  const slotsSvc = createSlotsService({ settlement, arc: arc as never, platformWallet: WALLETS.platform });
  const usageSvc = createUsageService(slotsSvc);
  const embeddings = createEmbeddingService();

  // Users
  for (const [wallet, name] of [
    [WALLETS.supplierMusic, 'Beachhead Music'],
    [WALLETS.supplierBrand, 'Beachhead Brands'],
    [WALLETS.channelOwner, 'Beachhead Channel Ops'],
    [WALLETS.platform, 'Platform'],
  ] as const) {
    await ensureUser(wallet, name);
  }
  // Published submissions for music listings — one per music listing
  console.log('  Seeding submissions for music listings...');
  for (let i = 0; i < MUSIC_LISTINGS.length; i++) {
    const m = MUSIC_LISTINGS[i];
    const id = `bh-music-${String(i + 1).padStart(3, '0')}`;
    const existing = await db.select({ id: submissionsTable.id }).from(submissionsTable).where(eq(submissionsTable.id, id)).limit(1);
    if (existing.length === 0) {
      await db.insert(submissionsTable).values(makeSilentSubmission(id, WALLETS.supplierMusic, m.title, m.supplierName));
      console.log(`    + ${id}: ${m.title}`);
    }
    m.submissionId = id;
  }

  // Listings — both kinds
  const allDefs = [...MUSIC_LISTINGS, ...PLACEMENT_LISTINGS];
  console.log(`\n  Creating ${allDefs.length} listings (music ${MUSIC_LISTINGS.length} + placement ${PLACEMENT_LISTINGS.length})...`);
  const created: Array<{ id: string; kind: string; tier: string; title: string }> = [];
  for (const def of allDefs) {
    const supplierWallet = def.kind === 'music' ? WALLETS.supplierMusic : WALLETS.supplierBrand;
    const result = await listingsSvc.create({
      supplierWallet,
      kind: def.kind,
      title: def.title,
      supplierName: def.supplierName,
      summary: def.summary,
      tags: def.tags,
      images: def.images,
      submissionId: def.submissionId ?? null,
      tier: def.tier,
      pricing: def.pricing as never,
      budgetCapUsdc: def.budgetCapUsdc ?? null,
      agreementVersion: AGREEMENT_VERSION,
    });
    if (!result.ok) {
      // Reuse existing listing with same title (re-run idempotent) — skip embed
      console.log(`    · skip ${def.title}: ${result.code} ${result.message}`);
      continue;
    }
    created.push({ id: result.listing.id, kind: result.listing.kind, tier: result.listing.tier, title: result.listing.title });
    console.log(`    + ${result.listing.kind} [${result.listing.tier}] ${result.listing.title} (${result.listing.id.slice(0,8)})`);
  }
  console.log(`  ${created.length} listings created (skipped ${allDefs.length - created.length} existing).`);

  // Backfill listing embeddings so Browse ranking works even in mock
  console.log('\n  Embedding listings...');
  const embRes = await embeddings.embedAllMarketplace();
  console.log(`    listings: ${embRes.listings} embedded, channels pending, skipped ${embRes.skipped}, mock=${embRes.mock}`);

  // Channels — mock-verified in CI (no YOUTUBE_API_KEY → mock + pending), verified when key present
  console.log('\n  Creating channels...');
  const channelIds: string[] = [];
  for (const def of CHANNEL_DEFS) {
    const res = await channelsSvc.register({
      ownerWallet: WALLETS.channelOwner,
      platformUrl: def.url,
      niche: def.niche,
      ethosSummary: def.ethos,
      agreementVersion: AGREEMENT_VERSION,
    });
    if (!res.ok) {
      console.log(`    · channel failed: ${def.url} — ${res.code} ${res.message}`);
      continue;
    }
    channelIds.push(res.channel.id);
    console.log(`    + ${res.channel.name} (${res.channel.verification_status}, ${res.channel.stats.source}) — ${res.channel.id.slice(0,8)} ${res.alreadyRegistered ? '(existing)' : ''}`);
  }
  const chEmb = await embeddings.embedAllMarketplace();
  console.log(`    channels embedded: ${chEmb.channels}, skipped ${chEmb.skipped}`);

  // Paid demo: buy one paid listing with channel + log usage proof
  // Pick first paid placement + first channel. Works even when channel is pending/mock
  // in CI — the slots gate would fail, so we force a mock-verified channel for the demo.
  // For the seed we tolerate mock: set verification_status=verified when mock is true
  // only for the happy-path demo. In production, real verification is required.
  if (created.length > 0 && channelIds.length > 0) {
    let paidListing = created.find((c) => c.tier === 'paid');
    if (paidListing) {
      console.log('\n  Demo: paid slot + usage proof...');
      // Ensure the buying channel is verified for the seed demo when running against
      // a real DB without a YouTube key — patch status to verified so the slot gate passes.
      // This is seed-only; the verification predicate (canBuySlots) is not bypassed in app code.
      const { channels } = await import('../src/lib/schema');
      const [chRow] = await db.select().from(channels).where(eq(channels.id, channelIds[0])).limit(1);
      if (chRow && chRow.verificationStatus !== 'verified') {
        await db.update(channels).set({ verificationStatus: 'verified', statsSource: 'mock', status: 'active' } as never).where(eq(channels.id, channelIds[0]));
        console.log('    (patched channel to verified for demo — mock numbers)');
      }
      const slotRes = await slotsSvc.create({ listingId: paidListing.id, channelId: channelIds[0], buyerWallet: WALLETS.buyer, budgetUsdc: '50' });
      if (!slotRes.ok) {
        console.log(`    slot create failed: ${slotRes.code} ${slotRes.message}`);
      } else {
        console.log(`    + slot ${slotRes.slot.id.slice(0,8)} (${slotRes.slot.pricing_model}, budget ${slotRes.slot.budget_usdc}) ${slotRes.alreadyExisted ? '(existing)' : ''}`);
        const payRes = await slotsSvc.pay(slotRes.slot.id, WALLETS.buyer);
        if (!payRes.ok) {
          console.log(`    pay failed: ${payRes.code} ${payRes.message}`);
        } else {
          console.log(`    + paid charged ${payRes.charged_usdc} mock=${payRes.mock} legs=${payRes.legs.length}`);
          const usageRes = await usageSvc.log({
            listingId: paidListing.id,
            channelId: channelIds[0],
            reporterWallet: WALLETS.buyer,
            slotId: slotRes.slot.id,
            videoUrl: 'https://www.youtube.com/watch?v=demo-beachhead-1',
            impressions: 1200,
            reportedBy: 'channel',
          });
          if (!usageRes.ok) console.log(`    usage failed: ${usageRes.code} ${usageRes.message}`);
          else console.log(`    + usage proof ${usageRes.usage.id.slice(0,8)} (spend ${usageRes.usage.spend_usdc}, ${usageRes.usage.impressions} imp)`);
        }
      }
      // Organic free proof — first free listing too
      const freeListing = created.find((c) => c.tier === 'free');
      if (freeListing) {
        const organic = await usageSvc.log({
          listingId: freeListing.id,
          channelId: channelIds[0],
          reporterWallet: WALLETS.buyer,
          videoUrl: 'https://www.youtube.com/watch?v=demo-beachhead-free',
          impressions: 4000,
          reportedBy: 'channel',
        });
        if (organic.ok) console.log(`    + organic usage ${organic.usage.id.slice(0,8)} for free listing ${freeListing.title.slice(0,24)}`);
      }
    }
  }

  const sum = await usageSvc.summary();
  console.log(`\n✅ Beachhead seed done — ${created.length} listings, ${channelIds.length} channels, usage: ${sum.total_events} events (${sum.sponsored_events} sponsored, ${sum.organic_events} organic), spend ${sum.spend_usdc} USDC`);
}

main().catch((err) => {
  console.error('❌ Beachhead seed failed:', err);
  process.exit(1);
});
