// MODULAR: agent-stream lifecycle tests. Asserts the per-agent chains in
// reviewSubmission emit honest started/verdict/consensus events over the
// event bus, that failures degrade to agent_failed without publishing,
// and that racing chains produce exactly one consensus + one pv row.

const { initTestDb: _initTestDb, getTestDb: _getTestDb, resetTestDb: _resetTestDb } = await import('../helpers/db');
const { vi, describe, it, expect, beforeAll, beforeEach, afterEach } = await import('vitest');
vi.mock('@/lib/db', () => ({
  get db() { return _getTestDb(); },
}));

const { createArcAdapter } = await import('../../src/adapters/arc');
const { createSubmissionsService } = await import('../../src/services/submissions');
const { createSettlementService } = await import('../../src/services/settlement');
const { createLlmAdapter } = await import('../../src/adapters/llm');
const { createAgentService } = await import('../../src/services/agents');
const { subscribe, clearSubscriptions } = await import('../../src/lib/event-bus');
const { publishedVersions } = await import('../../src/lib/schema');
const { eq } = await import('drizzle-orm');
const { signMessage, TEST_ADDRESSES } = await import('../helpers/sig');

import type { AgentStreamEvent } from '../../src/lib/event-bus';
import type { LlmAdapter } from '../../src/adapters/llm';

const TEST_PLATFORM_WALLET = TEST_ADDRESSES.acc0;
const AGENT_WALLETS = [TEST_ADDRESSES.acc1, TEST_ADDRESSES.acc2, TEST_ADDRESSES.acc3];

let submissions: ReturnType<typeof createSubmissionsService>;
let settlement: ReturnType<typeof createSettlementService>;
let llm: ReturnType<typeof createLlmAdapter>;
let submissionId: string;

function collectStream(): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = [];
  subscribe('agent-stream', (data) => {
    events.push(data as AgentStreamEvent);
  });
  return events;
}

beforeAll(async () => {
  await _initTestDb();
  const arc = createArcAdapter({ rpcUrl: null, usdcContract: null, platformWallet: TEST_PLATFORM_WALLET });
  submissions = createSubmissionsService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  settlement = createSettlementService({ arc, platformWallet: TEST_PLATFORM_WALLET });
  llm = createLlmAdapter({});
});

beforeEach(async () => {
  await _resetTestDb();
  clearSubscriptions();
  const sig = await signMessage(1, 'VERSIONS_LEPTON_SUBMIT');
  const r = await submissions.createSubmission({
    audioPath: 'data/uploads/test.mp3',
    contentType: 'audio/mpeg',
    sizeBytes: 1024,
    durationSeconds: 180,
    metadata: {
      title: 'Stream Test',
      artistName: 'Stream Artist',
      versionType: 'live',
      genre: 'rock',
      mood: 'energetic',
      description: 'A live rock performance',
    },
    artistWallet: TEST_ADDRESSES.acc1,
    signature: sig,
  });
  if (!r.ok) throw new Error('setup failed: ' + r.error);
  submissionId = r.submission.id;
  const v = await submissions.verifyPayment(submissionId, '0x' + 'a'.repeat(64));
  if (!v.ok) throw new Error('verify failed: ' + v.error);
});

afterEach(() => {
  clearSubscriptions();
});

describe('agent-stream: full lifecycle', () => {
  it('emits 3 started, 3 verdicts, exactly 1 consensus — in order', async () => {
    const events = collectStream();
    const agents = createAgentService({ llm, settlement, agentWallets: AGENT_WALLETS });

    const result = await agents.reviewSubmission(submissionId);
    expect(result.ok).toBe(true);

    const started = events.filter((e) => e.type === 'agent_started');
    const verdicts = events.filter((e) => e.type === 'agent_verdict');
    const consensus = events.filter((e) => e.type === 'consensus');
    const failed = events.filter((e) => e.type === 'agent_failed');

    expect(started.length).toBe(3);
    expect(verdicts.length).toBe(3);
    expect(consensus.length).toBe(1);
    expect(failed.length).toBe(0);

    // Per-agent: started before verdict.
    for (const name of ['production', 'performance', 'market']) {
      const si = events.findIndex((e) => e.type === 'agent_started' && e.agentName === name);
      const vi_ = events.findIndex((e) => e.type === 'agent_verdict' && e.agentName === name);
      expect(si).toBeGreaterThanOrEqual(0);
      expect(vi_).toBeGreaterThan(si);
    }

    // Consensus is the last event.
    expect(events[events.length - 1].type).toBe('consensus');

    // Honest mock badging on every payload.
    for (const e of events) {
      expect(e.submissionId).toBe(submissionId);
      if (e.type !== 'agent_failed') expect(e.mock).toBe(true);
    }

    const c = consensus[0];
    if (c.type !== 'consensus') throw new Error('unreachable');
    expect(c.published).toBe(true);
    expect(c.ratingCount).toBe(3);
    expect(typeof c.avgSolo).toBe('number');
    expect(typeof c.avgVocal).toBe('number');

    // Verdict payloads carry the full rationale + rubric.
    for (const e of verdicts) {
      if (e.type !== 'agent_verdict') continue;
      expect(e.reviewId).toBeTruthy();
      expect(typeof e.notes).toBe('string');
      expect(e.notes.length).toBeGreaterThan(0);
      expect(e.solo).toBeGreaterThanOrEqual(1);
      expect(e.vocal).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(e.moodTags)).toBe(true);
    }
  });

  it('one unparseable non-mock agent → 2 verdicts + 1 failed, no consensus, no publish', async () => {
    const events = collectStream();
    // Stub adapter: mock=false so the fallback path is exercised; the
    // performance agent returns garbage with no MOCK_TEMPLATES escape.
    const stub: LlmAdapter = {
      mock: false,
      model: 'stub',
      apiUrl: null,
      complete: async (args) => {
        if (args.agentName === 'performance') {
          return { text: 'not json at all {{{', parsed: null, usage: { promptTokens: 0, completionTokens: 0 }, mock: false };
        }
        return llm.complete(args);
      },
    };
    const agents = createAgentService({ llm: stub, settlement, agentWallets: AGENT_WALLETS });

    const result = await agents.reviewSubmission(submissionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reviews.length).toBe(2);
    expect(result.rating_count).toBe(2);
    expect(result.published).toBeNull();

    expect(events.filter((e) => e.type === 'agent_started').length).toBe(3);
    expect(events.filter((e) => e.type === 'agent_verdict').length).toBe(2);
    const failed = events.filter((e) => e.type === 'agent_failed');
    expect(failed.length).toBe(1);
    if (failed[0].type === 'agent_failed') {
      expect(failed[0].agentName).toBe('performance');
    }
    expect(events.filter((e) => e.type === 'consensus').length).toBe(0);
  });

  it('race sanity: staggered chains → exactly one consensus + one pv row', async () => {
    const events = collectStream();
    const delays: Record<string, number> = { production: 5, performance: 10, market: 15 };
    const staggered: LlmAdapter = {
      mock: true,
      model: 'staggered',
      apiUrl: null,
      complete: async (args) => {
        await new Promise((r) => setTimeout(r, delays[args.agentName] ?? 0));
        return llm.complete(args);
      },
    };
    const agents = createAgentService({ llm: staggered, settlement, agentWallets: AGENT_WALLETS });

    const result = await agents.reviewSubmission(submissionId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rating_count).toBe(3);
    expect(result.published).not.toBeNull();
    expect(result.published!.alreadyPublished).toBe(false);

    expect(events.filter((e) => e.type === 'consensus').length).toBe(1);

    const pvRows = await _getTestDb()
      .select()
      .from(publishedVersions)
      .where(eq(publishedVersions.submissionId, submissionId));
    expect(pvRows.length).toBe(1);
  });
});
