// MODULAR: Seed script — populates the catalog with demo data so judges
// see a non-empty app on first load. Creates:
//   1. 3 curator wallets + 1 artist wallet (if not exist)
//   2. 4 submissions (1 awaiting_curation, 3 published)
//   3. Agent reviews + ratings for each published submission
//   4. Published versions + settlement legs (pending)
//   5. One A&R playlist with tracks
//
// Run:   npx tsx scripts/seed-catalog.ts
//        DATABASE_URL=postgres://... npx tsx scripts/seed-catalog.ts

import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../src/lib/db';
import {
  users as usersTable,
  submissions as submissionsTable,
  ratings as ratingsTable,
  agentReviews as agentReviewsTable,
  publishedVersions as pvTable,
  settlementLegs as legsTable,
  arPlaylists as playlistsTable,
  arPlaylistTracks as playlistTracksTable,
} from '../src/lib/schema';
import { buildLegs } from '../src/services/settlement';
import { assertMoodTagsShape } from '../src/lib/format';
import type { AgentName, Energy, Tempo } from '../src/lib/types';

// ── Deterministic UUIDs for reproducibility ─────────────

const IDS = {
  // Users
  artistWallet: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
  curator1: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  curator2: '0x3C44CdDdB6a900fA2b585dd299e03d12FA4293BC',
  curator3: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  platformWallet: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  // Submissions
  subPending: 'demo-pending-0001-0000-000000000001',
  subNeon:   'demo-published-0002-0000-000000000002',
  subAutumn: 'demo-published-0003-0000-000000000003',
  subStreet: 'demo-published-0004-0000-000000000004',
};

// ── Track definitions ────────────────────────────────────

interface TrackDef {
  id: string;
  title: string;
  artistName: string;
  versionType: string;
  genre: string;
  mood: string;
  description: string;
  audioPath: string;
  audioDurationSeconds: number;
  audioSizeBytes: number;
  contentType: string;
  feeQuoteUsdc: string;
  status: string;
  coverSvg: string | null;
}

const TRACKS: TrackDef[] = [
  {
    id: IDS.subPending,
    title: 'Midnight Blues',
    artistName: 'Luna Rivera',
    versionType: 'demo',
    genre: 'rock',
    mood: 'bluesy',
    description: 'A raw demo recorded live in the studio at 3am. Single mic, first take.',
    audioPath: 'seeds/midnight-blues.mp3',
    audioDurationSeconds: 214,
    audioSizeBytes: 5140,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    status: 'awaiting_curation',
    coverSvg: null,
  },
  {
    id: IDS.subNeon,
    title: 'Neon Dreams',
    artistName: 'Luna Rivera',
    versionType: 'live',
    genre: 'electronic',
    mood: 'dreamy',
    description: 'Live set recording from the Neon Lights festival. Audience captured on the room mic.',
    audioPath: 'seeds/neon-dreams.mp3',
    audioDurationSeconds: 312,
    audioSizeBytes: 7480,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    status: 'published',
    coverSvg: null,
  },
  {
    id: IDS.subAutumn,
    title: 'Autumn Leaves',
    artistName: 'The Wandering Folk',
    versionType: 'acoustic',
    genre: 'folk',
    mood: 'melancholic',
    description: 'An intimate living-room recording. Two guitars, one voice, no edits.',
    audioPath: 'seeds/autumn-leaves.mp3',
    audioDurationSeconds: 267,
    audioSizeBytes: 6400,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    status: 'published',
    coverSvg: null,
  },
  {
    id: IDS.subStreet,
    title: 'Street Poetry',
    artistName: 'MC Concrete',
    versionType: 'remix',
    genre: 'hip-hop',
    mood: 'raw',
    description: 'A reimagined version of the original track with new verses and a live band arrangement.',
    audioPath: 'seeds/street-poetry.mp3',
    audioDurationSeconds: 248,
    audioSizeBytes: 5950,
    contentType: 'audio/mpeg',
    feeQuoteUsdc: '0.50',
    status: 'published',
    coverSvg: null,
  },
];

// ── Agent review templates ───────────────────────────────

interface ReviewDef {
  agentName: AgentName;
  soloIntensity: number;
  vocalQuality: number;
  energyVsStudio: Energy;
  tempoFeel: Tempo;
  moodTags: string[];
  notes: string;
}

const AGENT_WALLETS: Record<AgentName, string> = {
  production: IDS.curator1,
  performance: IDS.curator2,
  market: IDS.curator3,
};

const REVIEWS: Record<string, ReviewDef[]> = {
  [IDS.subNeon]: [
    {
      agentName: 'production',
      soloIntensity: 8,
      vocalQuality: 7,
      energyVsStudio: 'same',
      tempoFeel: 'locked',
      moodTags: ['Dreamy', 'Polished', 'Atmospheric'],
      notes: 'Clean mix with excellent stereo imaging. The live recording captures room depth without muddying the transients. The bass sits well in the mix — no frequency masking on the kick.',
    },
    {
      agentName: 'performance',
      soloIntensity: 9,
      vocalQuality: 8,
      energyVsStudio: 'higher',
      tempoFeel: 'rushing',
      moodTags: ['Euphoric', 'Energetic', 'Dynamic'],
      notes: 'The vocalist plays off the crowd energy beautifully. There is a slight rush in the second chorus that actually works in context — it feels intentional. Strong emotional arc throughout.',
    },
    {
      agentName: 'market',
      soloIntensity: 6,
      vocalQuality: 7,
      energyVsStudio: 'same',
      tempoFeel: 'locked',
      moodTags: ['Electronic', 'Groovy', 'Accessible'],
      notes: 'Strong festival appeal. The live energy + polished mix makes this a candidate for electronic music blogs and festival playlists. Recommend targeting Boiler Room and electronic YouTube channels.',
    },
  ],
  [IDS.subAutumn]: [
    {
      agentName: 'production',
      soloIntensity: 7,
      vocalQuality: 9,
      energyVsStudio: 'lower',
      tempoFeel: 'dragging',
      moodTags: ['Intimate', 'Warm', 'Natural'],
      notes: 'The recording is warm and present with a natural room reverb that suits the material. The finger-picked guitar has a pleasant mid-range body. The vocal is slightly forward in the mix, which is appropriate for the style.',
    },
    {
      agentName: 'performance',
      soloIntensity: 6,
      vocalQuality: 9,
      energyVsStudio: 'same',
      tempoFeel: 'dragging',
      moodTags: ['Melancholic', 'Vulnerable', 'Honest'],
      notes: 'Exceptional vocal control and phrasing. The slight drag in tempo adds to the reflective mood. The harmonies in the bridge are perfectly balanced. This is the kind of recording that makes you stop what you are doing and listen.',
    },
    {
      agentName: 'market',
      soloIntensity: 5,
      vocalQuality: 8,
      energyVsStudio: 'lower',
      tempoFeel: 'locked',
      moodTags: ['Folk', 'Americana', 'Singer-Songwriter'],
      notes: 'Strong fit for NPR Tiny Desk, folk playlists, and editorial singer-songwriter collections. The stripped-down arrangement is a feature, not a limitation. Suggest pitching to KEXP and folk radio programmers.',
    },
  ],
  [IDS.subStreet]: [
    {
      agentName: 'production',
      soloIntensity: 7,
      vocalQuality: 6,
      energyVsStudio: 'higher',
      tempoFeel: 'rushing',
      moodTags: ['Raw', 'Bold', 'Live Band'],
      notes: 'The live band arrangement adds real weight to the track. The brass hits are punchy and well-captured. The vocal is compressed aggressively which works for the style but loses some transient detail.',
    },
    {
      agentName: 'performance',
      soloIntensity: 8,
      vocalQuality: 7,
      energyVsStudio: 'higher',
      tempoFeel: 'rushing',
      moodTags: ['Lyrical', 'Aggressive', 'Charismatic'],
      notes: 'Commanding delivery with sharp rhythmic phrasing. The new verses elevate the original material. The energy builds effectively through the track, and the call-and-response sections would work well live.',
    },
    {
      agentName: 'market',
      soloIntensity: 7,
      vocalQuality: 6,
      energyVsStudio: 'same',
      tempoFeel: 'rushing',
      moodTags: ['Hip-Hop', 'Alternative', 'Boom Bap'],
      notes: 'The live band remix angle is a strong differentiator. Fits the alternative hip-hop space — think COLORS, NPR Tiny Desk hip-hop editions, and Lyrical Lemonade. The raw energy is marketable.',
    },
  ],
};

// ── Main ─────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding catalog...\n');

  // ── 1. Users ─────────────────────────────────────────
  console.log('  Creating users...');
  const userWallets = [
    { wallet: IDS.artistWallet, name: 'Luna Rivera' },
    { wallet: IDS.curator1, name: 'Production Agent' },
    { wallet: IDS.curator2, name: 'Performance Agent' },
    { wallet: IDS.curator3, name: 'Market Agent' },
    { wallet: IDS.platformWallet, name: 'Platform' },
  ];
  for (const u of userWallets) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.walletAddress, u.wallet))
      .limit(1);
    if (!existing) {
      await db.insert(usersTable).values({
        id: randomUUID(),
        walletAddress: u.wallet,
        displayName: u.name,
      });
    }
  }
  console.log(`    ${userWallets.length} wallets ready.`);

  // ── 2. Submissions ───────────────────────────────────
  console.log('  Creating submissions...');
  for (const t of TRACKS) {
    const [existing] = await db
      .select({ id: submissionsTable.id })
      .from(submissionsTable)
      .where(eq(submissionsTable.id, t.id))
      .limit(1);
    if (existing) {
      console.log(`    ${t.title} — already exists, skipping.`);
      continue;
    }
    await db.insert(submissionsTable).values({
      id: t.id,
      artistWallet: IDS.artistWallet,
      title: t.title,
      artistName: t.artistName,
      versionType: t.versionType,
      genre: t.genre,
      artistMood: t.mood,
      description: t.description,
      audioPath: t.audioPath,
      audioDurationSeconds: t.audioDurationSeconds,
      audioSizeBytes: t.audioSizeBytes,
      contentType: t.contentType,
      feeQuoteUsdc: t.feeQuoteUsdc,
      status: t.status,
      coverSvg: t.coverSvg,
      ratingCount: t.status === 'published' ? 3 : 0,
      submittedAt: new Date(Date.now() - 86400000 * TRACKS.indexOf(t)), // stagger by 1 day each
    });
    console.log(`    ${t.title} (${t.status})`);
  }

  // ── 3. Agent reviews + ratings (for published tracks) ─
  console.log('  Creating agent reviews and ratings...');
  const publishedTracks = TRACKS.filter((t) => t.status === 'published');
  for (const t of publishedTracks) {
    const reviews = REVIEWS[t.id];
    if (!reviews) continue;

    for (const r of reviews) {
      const [existingReview] = await db
        .select({ id: agentReviewsTable.id })
        .from(agentReviewsTable)
        .where(eq(agentReviewsTable.submissionId, t.id))
        .limit(1);
      if (existingReview) {
        console.log(`    reviews for ${t.title} already exist, skipping.`);
        break;
      }

      const reviewId = randomUUID();
      const ratingId = randomUUID();
      const wallet = AGENT_WALLETS[r.agentName];

      await db.insert(agentReviewsTable).values({
        id: reviewId,
        submissionId: t.id,
        agentName: r.agentName,
        curatorWallet: wallet,
        soloIntensity: r.soloIntensity,
        vocalQuality: r.vocalQuality,
        energyVsStudio: r.energyVsStudio,
        tempoFeel: r.tempoFeel,
        moodTags: assertMoodTagsShape(r.moodTags),
        notes: r.notes,
      });

      await db.insert(ratingsTable).values({
        id: ratingId,
        submissionId: t.id,
        curatorWallet: wallet,
        soloIntensity: r.soloIntensity,
        vocalQuality: r.vocalQuality,
        energyVsStudio: r.energyVsStudio,
        tempoFeel: r.tempoFeel,
        moodTags: assertMoodTagsShape(r.moodTags),
        notes: r.notes,
      });
    }
    console.log(`    ${t.title} — ${reviews.length} agent reviews`);
  }

  // ── 4. Published versions + settlement legs ──────────
  console.log('  Creating published versions...');
  for (const t of publishedTracks) {
    const [existing] = await db
      .select({ submissionId: pvTable.submissionId })
      .from(pvTable)
      .where(eq(pvTable.submissionId, t.id))
      .limit(1);
    if (existing) {
      console.log(`    ${t.title} — already published, skipping.`);
      continue;
    }

    const reviews = REVIEWS[t.id];
    if (!reviews) continue;

    const avgSolo = reviews.reduce((s, r) => s + r.soloIntensity, 0) / reviews.length;
    const avgVocal = reviews.reduce((s, r) => s + r.vocalQuality, 0) / reviews.length;
    const energyCounts: Record<string, number> = {};
    const tempoCounts: Record<string, number> = {};
    const allTags: string[] = [];
    for (const r of reviews) {
      energyCounts[r.energyVsStudio] = (energyCounts[r.energyVsStudio] || 0) + 1;
      tempoCounts[r.tempoFeel] = (tempoCounts[r.tempoFeel] || 0) + 1;
      allTags.push(...r.moodTags);
    }
    const energyConsensus = Object.entries(energyCounts).sort((a, b) => b[1] - a[1])[0][0];
    const tempoConsensus = Object.entries(tempoCounts).sort((a, b) => b[1] - a[1])[0][0];
    const uniqueTags = [...new Set(allTags)];

    await db.insert(pvTable).values({
      submissionId: t.id,
      artistWallet: IDS.artistWallet,
      title: t.title,
      artistName: t.artistName,
      versionType: t.versionType,
      audioPath: t.audioPath,
      musicbrainzId: null,
      coverSvg: t.coverSvg,
      avgSoloIntensity: avgSolo,
      avgVocalQuality: avgVocal,
      energyConsensus,
      tempoConsensus,
      aggregatedMoodTags: assertMoodTagsShape(uniqueTags, "aggregated_mood_tags"),
      ratingCount: 3,
      publishedAt: new Date(Date.now() - 86400000 * TRACKS.indexOf(t)),
    });

    // Settlement legs (pending — no need for actual Arc settlement)
    const curatorWallets = reviews.map((r) => AGENT_WALLETS[r.agentName]);
    const legs = buildLegs({
      submissionId: t.id,
      feeQuoteUsdc: t.feeQuoteUsdc,
      curatorWallets,
      platformWallet: IDS.platformWallet,
      musicbrainzWallet: IDS.artistWallet,
    });

    await db.insert(legsTable).values(
      legs.map((l) => ({
        id: l.id,
        submissionId: l.submission_id,
        recipientWallet: l.recipient_wallet,
        recipientRole: l.recipient_role,
        amountUsdc: l.amount_usdc,
        status: 'pending',
      })),
    );

    console.log(`    ${t.title} — published with ${legs.length} settlement legs`);
  }

  // ── 5. A&R playlist ──────────────────────────────────
  console.log('  Creating A&R playlist...');
  const publishedIds = publishedTracks.map((t) => t.id);
  const [existingPlaylist] = await db
    .select({ id: playlistsTable.id })
    .from(playlistsTable)
    .limit(1);

  if (!existingPlaylist) {
    const playlistId = randomUUID();
    await db.insert(playlistsTable).values({
      id: playlistId,
      name: 'Electric Dreams Sessions',
      description:
        'The A&R agent curated this set from the published catalog based on taste-graph compatibility, production quality, and listener engagement patterns. A mix of electronic, folk, and hip-hop that tells a story across genre lines.',
      genre: 'mixed',
      mood: 'dreamy',
      arWallet: IDS.platformWallet,
      trackCount: publishedIds.length,
    });

    for (let i = 0; i < publishedIds.length; i++) {
      await db.insert(playlistTracksTable).values({
        id: randomUUID(),
        playlistId,
        versionId: publishedIds[i],
        position: i + 1,
      });
    }
    console.log(`    "Electric Dreams Sessions" — ${publishedIds.length} tracks`);
  } else {
    console.log('    Playlist already exists, skipping.');
  }

  console.log('\n✅ Catalog seeded successfully!');
  console.log(`   ${TRACKS.length} submissions`);
  console.log(`   ${publishedTracks.length} published versions`);
  console.log(`   1 A&R playlist`);
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
