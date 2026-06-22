// MODULAR: Agent service. Orchestrates multi-agent review pipeline.
// DRY: each agent writes to agent_reviews (audit) + ratings (publish gate).
//      The curation service reads ratings as usual — no changes needed there.
// CLEAN: agents auto-claim and auto-rate without wallet signatures (server-side
//        operator wallets). The settlement service pays agent wallets on publish.

import { randomUUID } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  submissions as submissionsTable,
  ratings as ratingsTable,
  agentReviews as agentReviewsTable,
  curatorClaims as claimsTable,
  placementBriefs as briefsTable,
  publishedVersions as pvTable,
} from '../lib/schema';
import { publishSubmission } from './publish';
import type { LlmAdapter } from '../adapters/llm';
import type { SettlementService } from './settlement';
import type { AgentName } from '../lib/types';

export const PUBLISH_THRESHOLD = 3;

export const AGENT_NAMES: AgentName[] = ['production', 'performance', 'market'];

export const SYSTEM_PROMPTS: Record<AgentName, string> = {
  production: `You are a music production critic specializing in audio quality, mix, and mastering.
Analyze the track metadata and provide a structured review.
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
Analyze the track metadata and provide a structured review.
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
Analyze the track metadata and provide a structured review AND a placement brief.
Output ONLY valid JSON with these exact fields:
{
  "solo_intensity": <integer 1-10>,
  "vocal_quality": <integer 1-10>,
  "energy_vs_studio": "<one of: lower, same, higher>",
  "tempo_feel": "<one of: dragging, locked, rushing>",
  "mood_tags": ["<tag1>", "<tag2>", "<tag3>"],
  "notes": "<2-3 sentences of market analysis>",
  "placement_brief": {
    "venues": [{"name": "...", "reason": "...", "contact": "..."}],
    "youtube_channels": [{"name": "...", "reason": "...", "followers": "..."}],
    "influencers": [{"name": "...", "reason": "...", "platform": "..."}],
    "draft_emails": [{"to": "...", "subject": "...", "body": "..."}],
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
}): string {
  return `Review this track submission:

Title: ${submission.title}
Artist: ${submission.artist_name}
Version type: ${submission.version_type}
Genre: ${submission.genre || 'unspecified'}
Mood: ${submission.mood || 'unspecified'}
Description: ${submission.description || 'none provided'}
Audio duration: ${submission.audio_duration_seconds || 'unknown'}s
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
    venues: Array<{ name: string; reason: string; contact?: string }>;
    youtube_channels: Array<{ name: string; reason: string; followers?: string }>;
    influencers: Array<{ name: string; reason: string; platform?: string }>;
    draft_emails: Array<{ to: string; subject: string; body: string }>;
    audience_summary: string;
  };
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
    result.placement_brief = parsed.placement_brief as NonNullable<ParsedReview['placement_brief']>;
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

      const reviews: AgentReviewSummary[] = [];
      let brief: ParsedReview['placement_brief'] | null = null;

      for (let i = 0; i < AGENT_NAMES.length; i++) {
        const agentName = AGENT_NAMES[i];
        const wallet = agentWallets[i];

        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
        await db
          .insert(claimsTable)
          .values({
            id: randomUUID(),
            submissionId,
            curatorWallet: wallet,
            expiresAt,
          })
          .onConflictDoNothing();

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
          }),
          agentName,
          genre: sub.genre || 'rock',
          versionType: sub.versionType || 'live',
        });

        let parsed: ParsedReview | null = result.parsed || parseAgentResponse(result.text, agentName);
        if (!parsed) {
          console.warn(`[agents] ${agentName} returned unparseable response, using fallback`);
          const fallback =
            llm.mock === true
              ? null
              : (llm as unknown as { MOCK_TEMPLATES?: Record<AgentName, { getReview: (g: string, v: string) => ParsedReview }> })
                  .MOCK_TEMPLATES?.[agentName]?.getReview(sub.genre || 'rock', sub.versionType || 'live') ?? null;
          if (!fallback) continue;
          parsed = fallback;
        }

        const reviewId = randomUUID();
        const ratingId = randomUUID();

        await db.insert(agentReviewsTable).values({
          id: reviewId,
          submissionId,
          agentName,
          curatorWallet: wallet,
          soloIntensity: parsed.solo_intensity,
          vocalQuality: parsed.vocal_quality,
          energyVsStudio: parsed.energy_vs_studio,
          tempoFeel: parsed.tempo_feel,
          moodTags: parsed.mood_tags,
          notes: parsed.notes,
          rawResponse: result.text,
        });

        await db
          .insert(ratingsTable)
          .values({
            id: ratingId,
            submissionId,
            curatorWallet: wallet,
            soloIntensity: parsed.solo_intensity,
            vocalQuality: parsed.vocal_quality,
            energyVsStudio: parsed.energy_vs_studio,
            tempoFeel: parsed.tempo_feel,
            moodTags: parsed.mood_tags,
            notes: parsed.notes,
          })
          .onConflictDoNothing();

        await db
          .update(submissionsTable)
          .set({ ratingCount: sql`${submissionsTable.ratingCount} + 1` })
          .where(eq(submissionsTable.id, submissionId));

        reviews.push({
          id: reviewId,
          agent_name: agentName,
          curator_wallet: wallet,
          solo_intensity: parsed.solo_intensity,
          vocal_quality: parsed.vocal_quality,
          energy_vs_studio: parsed.energy_vs_studio,
          tempo_feel: parsed.tempo_feel,
          mood_tags: parsed.mood_tags,
          notes: parsed.notes,
          mock: result.mock,
        });

        if (agentName === 'market' && parsed.placement_brief) {
          const pb = parsed.placement_brief;
          await db
            .insert(briefsTable)
            .values({
              id: randomUUID(),
              submissionId,
              venues: pb.venues || [],
              youtubeChannels: pb.youtube_channels || [],
              influencers: pb.influencers || [],
              draftEmails: pb.draft_emails || [],
              audienceSummary: pb.audience_summary || '',
            })
            .onConflictDoUpdate({
              target: briefsTable.submissionId,
              set: {
                venues: pb.venues || [],
                youtubeChannels: pb.youtube_channels || [],
                influencers: pb.influencers || [],
                draftEmails: pb.draft_emails || [],
                audienceSummary: pb.audience_summary || '',
              },
            });
          brief = {
            venues: pb.venues || [],
            youtube_channels: pb.youtube_channels || [],
            influencers: pb.influencers || [],
            draft_emails: pb.draft_emails || [],
            audience_summary: pb.audience_summary || '',
          };
        }
      }

      const [refreshed] = await db
        .select({ ratingCount: submissionsTable.ratingCount })
        .from(submissionsTable)
        .where(eq(submissionsTable.id, submissionId))
        .limit(1);

      let published: PublishedSummary | null = null;
      if ((refreshed?.ratingCount ?? 0) >= PUBLISH_THRESHOLD) {
        const publishResult = await publishSubmission(submissionId, settlement);
        if (!publishResult.alreadyPublished) {
          const settleResults = await settlement.settleLegsAsync(publishResult.legIds);
          const { settlementLegs: legsTable } = await import('../lib/schema');
          const finalLegs = await db.select().from(legsTable).where(eq(legsTable.submissionId, submissionId));
          const [version] = await db.select().from(pvTable).where(eq(pvTable.submissionId, submissionId)).limit(1);
          published = {
            alreadyPublished: false,
            version,
            settlement_legs: finalLegs,
            settle_results: settleResults,
          };
        } else {
          published = { alreadyPublished: true };
        }
      }

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
        venues: row.venues,
        youtube_channels: row.youtubeChannels,
        influencers: row.influencers,
        draft_emails: row.draftEmails,
        audience_summary: row.audienceSummary,
        created_at: row.createdAt,
      };
    },
  };
}


