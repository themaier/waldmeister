import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { subscribe, channelFor, topicAuthorizer } from '$lib/server/sse';

// Generic SSE endpoint. The (topic, id) pair is resolved against the topic
// registry in $lib/server/sse-topics.ts — that's also where per-topic
// authorization lives, so this handler stays topic-agnostic.
export const GET: RequestHandler = async (event) => {
  const { params } = event;
  const authorize = topicAuthorizer(params.topic);
  if (!authorize) throw error(404, 'Unbekannter Stream.');

  const allowed = await authorize(event, params.id);
  if (!allowed) throw error(401, 'Nicht berechtigt.');

  const channel = channelFor(params.topic, params.id);

  const stream = new ReadableStream({
    start(controller) {
      const send = (eventName: string, data: unknown) => {
        controller.enqueue(`event: ${eventName}\n`);
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      };
      send('hello', { ok: true });
      const unsub = subscribe(channel, (payload) => send('update', payload));
      const ping = setInterval(() => controller.enqueue(': ping\n\n'), 15_000);
      const cleanup = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      (controller as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel() {
      (this as unknown as { _cleanup?: () => void })._cleanup?.();
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
};
