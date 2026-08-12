// MODULAR: Lightweight EventBus for cross-service pub/sub.
// CLEAN: services emit events when they make state changes; the SSE route
//        subscribes and streams them to clients. No external dependencies.
// PERFORMANT: O(1) subscribe/unsubscribe. Events are fire-and-forget — if
//             no subscribers exist, the emit is a no-op.

export type EventName =
  | 'feed-update'
  | 'queue-update'
  | 'submission-created'
  | 'playlist-update'
  | 'tip-received'
  | 'economy-event'
  | 'settlement-event'
  | 'agent-stream';

export interface FeedUpdateEvent {
  type: 'published';
  submissionId: string;
  timestamp: string;
}

export interface QueueUpdateEvent {
  type: 'submission_added' | 'submission_claimed' | 'submission_rated';
  submissionId: string;
  timestamp: string;
}

export interface SubmissionCreatedEvent {
  type: 'created';
  submissionId: string;
  artistWallet: string;
  timestamp: string;
}

export interface PlaylistUpdateEvent {
  type: 'generated';
  generated: number;
  playlists?: Array<{
    id: string;
    name: string;
    genre: string | null;
    reasoning: string | null;
  }>;
  timestamp: string;
}

// MODULAR: emitted by the x402 tip route when a tip proof is verified
// and submitted to the Gateway. Subscribers (artist dashboards, SSE
// stream, /feed) can react in real time to show the tip notification.
export interface TipReceivedEvent {
  type: 'verified';
  puid: string;
  tipperWallet: string;
  artistWallet: string;
  amountMicroUsdc: string;
  txHash: string | null;
  mock: boolean;
  timestamp: string;
}

// MODULAR: normalized "agent economy" activity item. Services emit one of
// these whenever something a demo-watcher cares about happens: an agent
// files a review, a tip proof verifies, a tip batch settles on-chain, a
// settlement leg pays out, or a pay-per-play clears. The SSE route
// forwards them verbatim; the EconomyTicker renders them with agent
// identity, USDC amounts, and ArcScan links. All fields JSON-safe; only
// `kind` and `timestamp` are required.
export interface EconomyEvent {
  kind: 'review' | 'tip' | 'tip_batch_settled' | 'leg_settled' | 'license_settled' | 'play';
  settlementId?: string;
  timestamp: string;
  // context
  submissionId?: string;
  title?: string | null;
  artistName?: string | null;
  agentName?: string;
  versionId?: string;
  playType?: string;
  recipientRole?: string;
  fromWallet?: string;
  toWallet?: string;
  // review payload (energy/tempo are the agents' qualitative strings)
  solo?: number;
  vocal?: number;
  energy?: string;
  tempo?: string;
  notes?: string | null;
  // money payload
  amountUsdc?: string;
  txHash?: string | null;
  artistTxHash?: string | null;
  listenerTxHash?: string | null;
  settledCount?: number;
  mock?: boolean;
}

// MODULAR: canonical money-settlement event. This is deliberately
// separate from `economy-event`: reviews and verified-payment activity
// can be noisy, while this stream is the one source of truth for a
// receipt-worthy state change. Client dashboards subscribe once and
// receive the same shape for licenses, tips, payout splits, and plays.
export interface SettlementEvent {
  type: 'settled';
  source: 'license' | 'tip' | 'split' | 'play';
  settlementId: string;
  timestamp: string;
  amountUsdc: string;
  txHash: string | null;
  mock: boolean;
  toWallet?: string;
  artistWallet?: string;
  tipperWallet?: string;
  submissionId?: string;
  versionId?: string;
  title?: string | null;
  artistName?: string | null;
  recipientRole?: string;
  jobId?: string | null;
  settledCount?: number;
}

/** Normalize the shared settlement stream into the ticker/stats shape. */
export function settlementToEconomyEvent(event: SettlementEvent): EconomyEvent {
  return {
    kind:
      event.source === 'license'
        ? 'license_settled'
        : event.source === 'tip'
          ? 'tip_batch_settled'
          : event.source === 'split'
            ? 'leg_settled'
            : 'play',
    settlementId: event.settlementId,
    timestamp: event.timestamp,
    amountUsdc: event.amountUsdc,
    txHash: event.txHash,
    mock: event.mock,
    toWallet: event.toWallet ?? event.artistWallet,
    fromWallet: event.tipperWallet,
    submissionId: event.submissionId,
    versionId: event.versionId,
    title: event.title,
    artistName: event.artistName,
    recipientRole: event.recipientRole,
    settledCount: event.settledCount,
  };
}

// MODULAR: per-agent review lifecycle events for the streaming reasoning
// surfaces (/agents monitor, landing demo snippets). Emitted when the fact
// actually happens: 'agent_started' just before the LLM call, 'agent_verdict'
// after the review row is persisted, 'consensus' when the third verdict
// triggers publish. The client typewriter is presentation only — these
// events carry real text and honest mock flags.
export type AgentStreamEvent =
  | {
      type: 'agent_started';
      submissionId: string;
      agentName: string;
      title: string | null;
      artistName: string | null;
      mock: boolean;
      timestamp: string;
    }
  | {
      type: 'agent_verdict';
      submissionId: string;
      agentName: string;
      reviewId: string;
      notes: string;
      solo: number;
      vocal: number;
      energy: string;
      tempo: string;
      moodTags: string[];
      mock: boolean;
      timestamp: string;
    }
  | {
      type: 'agent_failed';
      submissionId: string;
      agentName: string;
      error: string;
      timestamp: string;
    }
  | {
      type: 'consensus';
      submissionId: string;
      ratingCount: number;
      published: boolean;
      avgSolo: number | null;
      avgVocal: number | null;
      mock: boolean;
      timestamp: string;
    };

export type BusEvent =
  | FeedUpdateEvent
  | QueueUpdateEvent
  | SubmissionCreatedEvent
  | PlaylistUpdateEvent
  | TipReceivedEvent
  | EconomyEvent
  | SettlementEvent
  | AgentStreamEvent;

type Handler = (data: BusEvent) => void;

interface Subscription {
  event: EventName;
  handler: Handler;
}

let subscriptions: Subscription[] = [];

/**
 * Subscribe to an event. Returns an unsubscribe function.
 */
export function subscribe(event: EventName, handler: Handler): () => void {
  const sub: Subscription = { event, handler };
  subscriptions.push(sub);
  return () => {
    subscriptions = subscriptions.filter((s) => s !== sub);
  };
}

/**
 * Emit an event to all subscribers. Fire-and-forget — errors in handlers
 * are caught and logged so one bad handler can't break the bus.
 */
export function emit(event: EventName, data: BusEvent): void {
  for (const sub of subscriptions) {
    if (sub.event !== event) continue;
    try {
      sub.handler(data);
    } catch (err) {
      // PERFORMANT: isolate handler failures so they don't cascade.
      console.error('[event-bus] handler error:', err);
    }
  }
}

/**
 * Remove all subscriptions. Useful in tests to avoid leakage.
 */
export function clearSubscriptions(): void {
  subscriptions = [];
}
