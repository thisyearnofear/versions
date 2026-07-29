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
  | 'economy-event';

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
  kind: 'review' | 'tip' | 'tip_batch_settled' | 'leg_settled' | 'play';
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

export type BusEvent =
  | FeedUpdateEvent
  | QueueUpdateEvent
  | SubmissionCreatedEvent
  | PlaylistUpdateEvent
  | TipReceivedEvent
  | EconomyEvent;

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
