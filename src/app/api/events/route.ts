// MODULAR: SSE (Server-Sent Events) route. Keeps a long-lived connection
// open and pushes feed-update events to the client when the curation
// service publishes a new version. Multiple tabs share the same EventBus.
// PERFORMANT: one subscription per connection; the bus fan-out is O(n) for
//             n connected clients. Heartbeat keeps the proxy alive.
// CLEAN: no external dependencies — native Web Streams API.

import { subscribe, type BusEvent } from '@/lib/event-bus';

export const dynamic = 'force-dynamic';
export const preferredRegion = 'auto';

export async function GET(req: Request): Promise<Response> {
  const stream = new ReadableStream({
    start(controller) {
      // Subscribe to all event types that feed clients care about.
      const unsubFeedUpdate = subscribe('feed-update', (data) => {
        const payload = `event: feed-update\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      });

      const unsubQueueUpdate = subscribe('queue-update', (data) => {
        const payload = `event: queue-update\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      });

      // MODULAR: stream playlist-update events so the Discover view can
      // re-fetch playlists when the A&R agent regenerates them.
      const unsubPlaylistUpdate = subscribe('playlist-update', (data) => {
        const payload = `event: playlist-update\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(payload));
      });

      // Heartbeat every 30s keeps load-balancer / proxy timeouts at bay.
      const heartbeat = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
      }, 30_000);

      // Send an initial "connected" event so the client knows the stream
      // is ready (and can distinguish "no events yet" from "connection lost").
      controller.enqueue(new TextEncoder().encode(`event: connected\ndata: {}\n\n`));

      // Clean up when the client disconnects.
      req.signal.addEventListener('abort', () => {
        unsubFeedUpdate();
        unsubQueueUpdate();
        unsubPlaylistUpdate();
        clearInterval(heartbeat);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
