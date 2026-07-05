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
  | 'tip-received';

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

export type BusEvent =
  | FeedUpdateEvent
  | QueueUpdateEvent
  | SubmissionCreatedEvent
  | PlaylistUpdateEvent
  | TipReceivedEvent;

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
