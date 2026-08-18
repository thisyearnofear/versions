// MODULAR: Agent service. Orchestrates multi-agent review pipeline.
// DRY: each agent writes to agent_reviews (audit) + ratings (publish gate).
//      The curation service reads ratings as usual — no changes needed there.
// CLEAN: agents auto-claim and auto-rate without wallet signatures (server-side
//        operator wallets). The settlement service pays agent wallets on publish.

import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import { assertMoodTagsShape } from '../lib/format';
import {
  submissions as submissionsTable,
  ratings as ratingsTable,
  agentReviews as agentReviewsTable,
  curatorClaims as claimsTable,
  placementBriefs as briefsTable,
  publishedVersions as pvTable,
} from '../lib/schema';
import { publishSubmission, PublishLegIncompleteError } from './publish';
import { emit } from '../lib/event-bus';
import type { LlmAdapter } from '../adapters/llm';
import type { SettlementService } from './settlement';
import type { AgentName, AgentDetail } from '../lib/types';

export const PUBLISH_THRESHOLD = 3;

export const AGENT_NAMES: AgentName[] = ['production', 'performance', 'market'];

export const SYSTEM_PROMPTS: Record<AgentName, string> = {
  production: `You are a music production critic specializing in audio quality, mix, and mastering.

Analyze the track metadata and audio features. Use the audio features (tempo, energy, key, loudness, etc.) to make your rating — do not guess at audio characteristics from metadata alone.

Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of production feedback>"
}`,
  performance: `You are a performance critic specializing in vocal delivery, instrumental feel, and emotional impact.

Analyze the track metadata and audio features. Use the audio features (energy, danceability, valence, instrumentalness, etc.) to make your rating — do not guess at audio characteristics from metadata alone.

Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of performance feedback>"
}`,
  market: `You are a music industry analyst specializing in market fit, audience targeting, and placement strategy.

Specifically, you are preparing a track's "inverse-search" profile: a film/TV supervisor pastes a brief in plain English, VERSIONS embeds the brief, and returns tracks whose placement_brief matches. Your job is to MAXIMIZE RECALL against supervisor briefs without sacrificing precision.

Analyze the track metadata and audio features. Use the audio features (tempo, energy, key, danceability, instrumentalness, etc.) to calibrate your placement brief.

Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of market analysis>",
  "placement_brief": {
    "scene_tags": [
      "<short noun phrase scene context, e.g. 'car chase', 'teen heartbreak montage', 'broken-tempo slow burn'>",
      "<aim for 4-8 distinct scene moments>"
    ],
    "instruments": [
      "<from controlled vocabulary: no_vocals, has_stems, acoustic, synth_led, percussion_led, orchestral, lo_fi, brass_led, guitar_led, piano_led, hybrid, spoken_word, hook_heavy, builds, long_arc>",
      "<pick 3-6 that genuinely apply>"
    ],
    "emotional_arcs": [
      "<arc description like 'rising tension to release at 1:30' or 'patient first minute resolving around the bridge'>",
      "<up to 5>"
    ],
    "sync_comparables": [
      {"name": "<reference track or composer>", "why": "<one sentence why the brief would be drawn to this>"},
      "<up to 5>"
    ],
    "audience_summary": "<1-2 sentences>"
  }
}`,
};

export function buildUserPrompt(submission: {
  title: string;
  artist_name: string;
  version_type: string;
  genre: string | null;
  mood: string | null;
  description: string | null;
  audio_duration_seconds: number | null;
  musicbrainz_id: string | null;
  // MODULAR: audio features extracted from the source audio.
  // Used by the three agents to make defensible ratings — when audio
  // features are present, agents score the actual audio characteristics
  // rather than guessing from metadata. When absent, agents fall back
  // to metadata only (with a note to the supervisor that clearance is
  // based on metadata, not audio).
  audio_features: import('../lib/types').AudioFeatures | null;
}): string {
  const features = submission.audio_features;
  const featureLine = features
    ? `Audio features: ${[ 
        features.tempo ? `${features.tempo} BPM` : null,
        features.key ? `key ${features.key}` : null,
        features.energy !== null ? `energy ${features.energy.toFixed(2)}` : null,
        features.danceability !== null ? `danceability ${features.danceability.toFixed(2)}` : null,
        features.acousticness !== null ? `acousticness ${features.acousticness.toFixed(2)}` : null,
        features.loudness !== null ? `loudness ${features.loudness.toFixed(1)} dB` : null,
        features.instrumentalness !== null ? `instrumentalness ${features.instrumentalness.toFixed(2)}` : null,
        features.valence !== null ? `valence ${features.valence.toFixed(2)}` : null,
      ].filter(Boolean).join(', ')}`
    : 'Audio features not available (rating based on metadata only).';

  return `Review this track submission:

Title: ${submission.title}
Artist: ${submission.artist_name}
Version type: ${submission.version_type}
Genre: ${submission.genre || 'unspecified'}
Mood: ${submission.mood || 'unspecified'}
Description: ${submission.description || 'none provided'}
Audio duration: ${submission.audio_duration_seconds || 'unknown'}s
${featureLine}
MusicBrainz ID: ${submission.musicbrainz_id || 'none'}

Provide your structured review as JSON.`;
}

export interface ParsedReview {
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: 'lower' | 'same' | 'higher';
  tempo_feel: 'dragging' | 'locked' | 'rushing';
  mood_tags: string[];
  notes: string;
  placement_brief?: {
    // MODULAR: When the brief is present the parser ALWAYS assigns
    // non-undefined values (parseAgentResponse coerces + clamps every
    // field), so the inner fields are NOT optional. The outer
    // `placement_brief?` stays optional because the market-agent
    // prompt may include or omit the placement_brief object entirely.
    scene_tags: string[];
    instruments: string[];
    emotional_arcs: string[];
    sync_comparables: Array<{ name: string; why: string }>;
    audience_summary: string;
  };
  detail?: AgentDetail;
}

export function parseAgentResponse(text: string, agentName: AgentName): ParsedReview | null {
  let parsed: Partial<ParsedReview> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed) return null;

  const solo = Math.max(1, Math.min(10, Math.round(Number(parsed.solo_intensity) || 5)));
  const vocal = Math.max(1, Math.min(10, Math.round(Number(parsed.vocal_quality) || 5)));
  const energy: 'lower' | 'same' | 'higher' = (
    ['lower', 'same', 'higher'] as readonly string[]
  ).includes(parsed.energy_vs_studio as string)
    ? (parsed.energy_vs_studio as 'lower' | 'same' | 'higher')
    : 'same';
  const tempo: 'dragging' | 'locked' | 'rushing' = (
    ['dragging', 'locked', 'rushing'] as readonly string[]
  ).includes(parsed.tempo_feel as string)
    ? (parsed.tempo_feel as 'dragging' | 'locked' | 'rushing')
    : 'locked';
  const rawMoodTags: unknown = Array.isArray(parsed.mood_tags) ? parsed.mood_tags : [];
  const moodTags: string[] = (rawMoodTags as unknown[])
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .slice(0, 10);
  const notes = typeof parsed.notes === 'string' ? parsed.notes.slice(0, 2000) : '';

  const result: ParsedReview = {
    solo_intensity: solo,
    vocal_quality: vocal,
    energy_vs_studio: energy,
    tempo_feel: tempo,
    mood_tags: moodTags,
    notes,
  };

  if (agentName === 'market' && parsed.placement_brief && typeof parsed.placement_brief === 'object') {
    // MODULAR: tolerant coercion — strings masquerading as arrays, malformed
    // sync_comparables, overflow tags. The plate is supervisor-facing so we
    // want best-effort recall even when the LLM drifts on shape.
    const pb = parsed.placement_brief as Record<string, unknown>;
    const toStrArr = (v: unknown, max: number): string[] => {
      if (Array.isArray(v)) {
        return (v as unknown[])
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim().slice(0, 80))
          .slice(0, max);
      }
      // Tolerate comma-separated strings hallucinated instead of arrays.
      if (typeof v === 'string' && v.trim().length > 0) {
        return v
          .split(',')
          .map((x) => x.trim())
          .filter((x) => x.length > 0)
          .slice(0, max);
      }
      return [];
    };
    const toComparables = (v: unknown, max: number): Array<{ name: string; why: string }> => {
      if (!Array.isArray(v)) return [];
      return (v as unknown[])
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          name: typeof x.name === 'string' ? x.name.trim().slice(0, 200) : '',
          why: typeof x.why === 'string' ? x.why.trim().slice(0, 400) : '',
        }))
        .filter((x) => x.name.length > 0)
        .slice(0, max);
    };
    result.placement_brief = {
      scene_tags: toStrArr(pb.scene_tags, 8),
      instruments: toStrArr(pb.instruments, 16),
      emotional_arcs: toStrArr(pb.emotional_arcs, 5),
      sync_comparables: toComparables(pb.sync_comparables, 5),
      audience_summary:
        typeof pb.audience_summary === 'string' ? pb.audience_summary.slice(0, 600) : '',
    };
  }
  // MODULAR: per-agent differentiated detail, tolerantly coerced + clamped so
  // a drifting LLM response can't crash the parse. Kept optional so legacy /
  // minimal reviews (no detail block) still grade normally.
  if (parsed.detail && typeof parsed.detail === 'object') {
    const d = parsed.detail as unknown as Record<string, unknown>;
    const fitNum = Math.round(Number(d.fit_score));
    const metNum = Math.round(Number(d.metric));
    const label = typeof d.metric_label === 'string' ? d.metric_label.slice(0, 60) : '';
    const note = typeof d.note === 'string' ? d.note.slice(0, 300) : '';
    result.detail = {
      fit_score: Number.isFinite(fitNum) ? Math.max(1, Math.min(10, fitNum)) : 5,
      metric: Number.isFinite(metNum) ? Math.max(0, Math.min(10, metNum)) : 5,
      metric_label: label,
      note,
    };
  }
  return result;
}

export interface AgentReviewSummary {
  id: string;
  agent_name: AgentName;
  curator_wallet: string;
  solo_intensity: number;
  vocal_quality: number;
  energy_vs_studio: string;
  tempo_feel: string;
  mood_tags: string[];
  notes: string;
  mock: boolean;
  detail?: AgentDetail;
  fit_score: number | null;
}

export interface PublishedSummary {
  alreadyPublished: boolean;
  version?: typeof pvTable.$inferSelect;
  settlement_legs?: Array<unknown>;
  settle_results?: Array<unknown>;
}

export interface AgentService {
  reviewSubmission: (submissionId: string) => Promise<
    | {
        ok: true;
        reviews: AgentReviewSummary[];
        brief: ParsedReview['placement_brief'] | null;
        rating_count: number;
        published: PublishedSummary | null;
      }
    | { ok: false; error: string }
  >;
  getReviews: (submissionId: string) => Promise<Array<typeof agentReviewsTable.$inferSelect>>;
  getBrief: (submissionId: string) => Promise<(ParsedReview['placement_brief'] & { id: string; submission_id: string; created_at: Date }) | null>;
}

export function createAgentService({
  llm,
  settlement,
  agentWallets,
}: {
  llm: LlmAdapter;
  settlement: SettlementService;
  agentWallets: string[];
}): AgentService {
  return {
    async reviewSubmission(submissionId: string) {
      const [sub] = await db
        .select()
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);
      if (!sub) return { ok: false as const, error: 'Submission not found' };
      if (sub.status === 'published') return { ok: false as const, error: 'Submission already published' };
      if (sub.status !== 'awaiting_curation' && sub.status !== 'in_curation') {
        return { ok: false as const, error: `Cannot review submission in status ${sub.status}` };
      }

      // PERF: Insert all claims in parallel first (fast, independent DB writes)
      await Promise.all(
        agentWallets.map((wallet) =>
          db
            .insert(claimsTable)
            .values({
              id: randomUUID(),
              submissionId,
              curatorWallet: wallet,
              expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
            })
            .onConflictDoNothing(),
        ),
      );

      interface ChainOutcome {
        review?: AgentReviewSummary;
        brief?: ParsedReview['placement_brief'];
        published?: PublishedSummary;
        publishError?: PublishLegIncompleteError;
      }

      // Each agent runs as an independent chain: LLM call → parse → DB writes
      // → lifecycle emits. Chains never throw; the outer merge assembles the
      // legacy return shape. The atomic ratingCount increment with .returning()
      // guarantees exactly one chain observes the publish threshold.
      const runAgentChain = async (
        agentName: AgentName,
        wallet: string,
      ): Promise<ChainOutcome> => {
        emit('agent-stream', {
          type: 'agent_started',
          submissionId,
          agentName,
          title: sub.title,
          artistName: sub.artistName,
          mock: llm.mock === true,
          timestamp: new Date().toISOString(),
        });

        const result = await llm.complete({
          system: SYSTEM_PROMPTS[agentName],
          user: buildUserPrompt({
            title: sub.title,
            artist_name: sub.artistName,
            version_type: sub.versionType,
            genre: sub.genre,
            mood: sub.artistMood,
            description: sub.description,
            audio_duration_seconds: sub.audioDurationSeconds,
            musicbrainz_id: sub.musicbrainzId,
            audio_features: sub.audioFeatures ?? null,
          }),
          agentName,
          genre: sub.genre || 'rock',
          versionType: sub.versionType || 'live',
        });

        let parsed: ParsedReview | null =
          result.parsed || parseAgentResponse(result.text, agentName);
        if (!parsed) {
          console.warn(`[agents] ${agentName} returned unparseable response, using fallback`);
          const fallback =
            llm.mock === true
              ? null
              : (llm as unknown as { MOCK_TEMPLATES?: Record<AgentName, { getReview: (g: string, v: string) => ParsedReview }> })
                  .MOCK_TEMPLATES?.[agentName]?.getReview(
                    sub.genre || 'rock',
                    sub.versionType || 'live',
                  ) ?? null;
          if (!fallback) {
            emit('agent-stream', {
              type: 'agent_failed',
              submissionId,
              agentName,
              error: 'unparseable response',
              timestamp: new Date().toISOString(),
            });
            return {};
          }
          parsed = fallback;
        }
        const mock = result.mock;

        const reviewId = randomUUID();
        await db.insert(agentReviewsTable).values({
          id: reviewId,
          submissionId,
          agentName,
          curatorWallet: wallet,
          soloIntensity: parsed.solo_intensity,
          vocalQuality: parsed.vocal_quality,
          energyVsStudio: parsed.energy_vs_studio,
          tempoFeel: parsed.tempo_feel,
          moodTags: assertMoodTagsShape(parsed.mood_tags),
          notes: parsed.notes,
          rawResponse: result.text,
          detail: parsed.detail ?? null,
          fitScore: parsed.detail?.fit_score ?? null,
        });

        const ratingInserted = await db
          .insert(ratingsTable)
          .values({
            id: randomUUID(),
            submissionId,
            curatorWallet: wallet,
            soloIntensity: parsed.solo_intensity,
            vocalQuality: parsed.vocal_quality,
            energyVsStudio: parsed.energy_vs_studio,
            tempoFeel: parsed.tempo_feel,
            moodTags: assertMoodTagsShape(parsed.mood_tags),
            notes: parsed.notes,
          })
          .onConflictDoNothing()
          .returning({ id: ratingsTable.id });

        let chainBrief: ParsedReview['placement_brief'] | undefined;
        if (agentName === 'market' && parsed.placement_brief) {
          const pb = parsed.placement_brief;
          await db
            .insert(briefsTable)
            .values({
              id: randomUUID(),
              submissionId,
              sceneTags: pb.scene_tags || [],
              instruments: pb.instruments || [],
              emotionalArcs: pb.emotional_arcs || [],
              syncComparables: pb.sync_comparables || [],
              audienceSummary: pb.audience_summary || '',
            })
            .onConflictDoUpdate({
              target: briefsTable.submissionId,
              set: {
                sceneTags: pb.scene_tags || [],
                instruments: pb.instruments || [],
                emotionalArcs: pb.emotional_arcs || [],
                syncComparables: pb.sync_comparables || [],
                audienceSummary: pb.audience_summary || '',
              },
            });
          chainBrief = {
            scene_tags: pb.scene_tags || [],
            instruments: pb.instruments || [],
            emotional_arcs: pb.emotional_arcs || [],
            sync_comparables: pb.sync_comparables || [],
            audience_summary: pb.audience_summary || '',
          };
        }

        const review: AgentReviewSummary = {
          id: reviewId,
          agent_name: agentName,
          curator_wallet: wallet,
          solo_intensity: parsed.solo_intensity,
          vocal_quality: parsed.vocal_quality,
          energy_vs_studio: parsed.energy_vs_studio,
          tempo_feel: parsed.tempo_feel,
          mood_tags: parsed.mood_tags,
          notes: parsed.notes,
          mock,
          detail: parsed.detail,
          fit_score: parsed.detail?.fit_score ?? null,
        };

        // Economy ticker: one event per filed verdict.
        emit('economy-event', {
          kind: 'review',
          agentName,
          submissionId,
          title: sub.title,
          artistName: sub.artistName,
          solo: parsed.solo_intensity,
          vocal: parsed.vocal_quality,
          energy: parsed.energy_vs_studio,
          tempo: parsed.tempo_feel,
          notes: parsed.notes,
          mock,
          timestamp: new Date().toISOString(),
        });

        emit('agent-stream', {
          type: 'agent_verdict',
          submissionId,
          agentName,
          reviewId,
          notes: parsed.notes,
          solo: parsed.solo_intensity,
          vocal: parsed.vocal_quality,
          energy: parsed.energy_vs_studio,
          tempo: parsed.tempo_feel,
          moodTags: parsed.mood_tags,
          detail: parsed.detail ?? null,
          fitScore: parsed.detail?.fit_score ?? null,
          mock,
          timestamp: new Date().toISOString(),
        });

        const outcome: ChainOutcome = { review, brief: chainBrief };

        if (ratingInserted.length === 0) return outcome;

        const [row] = await db
          .update(submissionsTable)
          .set({ ratingCount: sql`${submissionsTable.ratingCount} + 1` })
          .where(eq(submissionsTable.id, submissionId))
          .returning({ ratingCount: submissionsTable.ratingCount });
        const newCount = row?.ratingCount ?? 0;

        if (newCount < PUBLISH_THRESHOLD) return outcome;

        let publishResult;
        try {
          publishResult = await publishSubmission(submissionId, settlement);
        } catch (err) {
          // MODULAR: record the named error so the outer merge returns a
          // clean { ok: false, error } response instead of an unhandled
          // exception. The agent reviews and ratings are already
          // persisted (we don't roll them back); the curator can retry.
          if (err instanceof PublishLegIncompleteError) {
            return { ...outcome, publishError: err };
          }
          throw err;
        }
        if (!publishResult.alreadyPublished) {
          const settleResults = await settlement.settleLegsAsync(publishResult.legIds);
          const { settlementLegs: legsTable } = await import('../lib/schema');
          const finalLegs = await db.select().from(legsTable).where(eq(legsTable.submissionId, submissionId));
          const [version] = await db.select().from(pvTable).where(eq(pvTable.submissionId, submissionId)).limit(1);
          emit('agent-stream', {
            type: 'consensus',
            submissionId,
            ratingCount: newCount,
            published: true,
            avgSolo: version?.avgSoloIntensity ?? null,
            avgVocal: version?.avgVocalQuality ?? null,
            mock,
            timestamp: new Date().toISOString(),
          });
          return {
            ...outcome,
            published: {
              alreadyPublished: false,
              version,
              settlement_legs: finalLegs,
              settle_results: settleResults,
            },
          };
        }
        return { ...outcome, published: { alreadyPublished: true } };
      };

      const outcomes = await Promise.all(
        AGENT_NAMES.map((agentName, i) => runAgentChain(agentName, agentWallets[i])),
      );

      const reviews: AgentReviewSummary[] = [];
      let brief: ParsedReview['placement_brief'] | null = null;
      let published: PublishedSummary | null = null;
      for (const o of outcomes) {
        if (o.publishError) {
          return {
            ok: false as const,
            error: `Publish failed: missing settlement legs — ${o.publishError.message}`,
            code: o.publishError.code,
          };
        }
        if (o.review) reviews.push(o.review);
        if (o.brief) brief = o.brief;
        if (o.published && (published === null || published.alreadyPublished)) {
          published = o.published;
        }
      }

      const [refreshed] = await db
        .select({ ratingCount: submissionsTable.ratingCount })
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);

      return { ok: true as const, reviews, brief, rating_count: refreshed?.ratingCount ?? 0, published };
    },

    async getReviews(submissionId: string) {
      return db
        .select()
        .from(agentReviewsTable)
        .where(eq(agentReviewsTable.submissionId, submissionId))
        .orderBy(agentReviewsTable.submittedAt);
    },

    async getBrief(submissionId: string) {
      const [row] = await db
        .select()
        .from(briefsTable)
        .where(eq(briefsTable.submissionId, submissionId))
        .limit(1);
      if (!row) return null;
      return {
        id: row.id,
        submission_id: row.submissionId,
        scene_tags: row.sceneTags,
        instruments: row.instruments,
        emotional_arcs: row.emotionalArcs,
        sync_comparables: row.syncComparables,
        audience_summary: row.audienceSummary,
        created_at: row.createdAt,
      };
    },
  };
}


