// Register every real-time topic the app exposes. Imported once at startup
// (from hooks.server.ts) so the generic /api/sse/[topic]/[id] endpoint can
// look up an authorizer per request.
//
// To add a new topic:
//   1. registerTopic('my-topic', async ({ locals }, id) => { ... });
//   2. publish(channelFor('my-topic', id), payload) from wherever the change
//      happens.
//   3. On the client, open EventSource(`/api/sse/my-topic/${id}`).
//
// Keeping this file single-sourced means there's one place to audit which
// real-time feeds exist and what they need for auth.

import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { workOrders } from './db/schema';
import { registerTopic } from './sse';

registerTopic('work-order', async ({ locals }, id) => {
  if (!locals.user) return false;
  const [row] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(and(eq(workOrders.id, id), eq(workOrders.ownerId, locals.user.id)))
    .limit(1);
  if (!row) throw error(404, 'Auftrag nicht gefunden.');
  return true;
});
