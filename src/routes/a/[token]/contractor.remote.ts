import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { workOrders, workOrderTrees, users } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { publish, channelFor } from '$lib/server/sse';
import { sendMail, renderWorkOrderCompletedEmail } from '$lib/server/email';

const notesSchema = z.object({
  token: z.string().min(1),
  notes: z.string().max(5000)
});

export const saveContractorNotes = command('unchecked', async (raw: unknown) => {
  const parsed = notesSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);

  const [order] = await db
    .select({ id: workOrders.id })
    .from(workOrders)
    .where(eq(workOrders.shareToken, parsed.data.token))
    .limit(1);
  if (!order) throw error(404, 'Auftrag nicht gefunden.');

  await db
    .update(workOrders)
    .set({ workerNotes: parsed.data.notes, updatedAt: new Date() })
    .where(eq(workOrders.id, order.id));
  publish(channelFor('work-order', order.id), { type: 'notes-updated' });
  return { ok: true };
});

const treeStatusSchema = z.object({
  token: z.string().min(1),
  assignmentId: z.string().uuid(),
  status: z.enum(['OPEN', 'COMPLETED', 'NOT_FOUND', 'PROBLEM']),
  statusMessage: z.string().nullable().optional()
});

export const updateContractorTreeStatus = command('unchecked', async (raw: unknown) => {
  // `getRequestEvent()` is only available when the command runs within an actual request.
  // Depending on how the remote command is invoked/bundled, this can throw; the status update
  // itself must still succeed, so we treat origin as best-effort.
  let origin: string | null = null;
  try {
    origin = getRequestEvent().url.origin;
  } catch {
    origin = null;
  }

  const parsed = treeStatusSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const input = parsed.data;

  const [assignment] = await db
    .select({
      id: workOrderTrees.id,
      workOrderId: workOrderTrees.workOrderId
    })
    .from(workOrderTrees)
    .innerJoin(workOrders, eq(workOrderTrees.workOrderId, workOrders.id))
    .where(and(eq(workOrderTrees.id, input.assignmentId), eq(workOrders.shareToken, input.token)))
    .limit(1);
  if (!assignment) throw error(404, 'Zuordnung nicht gefunden.');

  await db
    .update(workOrderTrees)
    .set({
      status: input.status,
      statusMessage: input.statusMessage ?? null,
      updatedAt: new Date()
    })
    .where(eq(workOrderTrees.id, input.assignmentId));

  const all = await db
    .select({ status: workOrderTrees.status })
    .from(workOrderTrees)
    .where(eq(workOrderTrees.workOrderId, assignment.workOrderId));
  const terminal = all.every((t) => t.status !== 'OPEN');
  if (terminal) {
    const [order] = await db
      .select({
        id: workOrders.id,
        ownerId: workOrders.ownerId,
        title: workOrders.title,
        workerNotes: workOrders.workerNotes,
        status: workOrders.status
      })
      .from(workOrders)
      .where(eq(workOrders.id, assignment.workOrderId));

    if (order && order.status !== 'COMPLETED') {
      await db
        .update(workOrders)
        .set({ status: 'COMPLETED', updatedAt: new Date() })
        .where(eq(workOrders.id, order.id));
      const [owner] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, order.ownerId));
      if (owner?.email) {
        try {
          const mail = renderWorkOrderCompletedEmail({
            title: order.title,
            completedAt: new Date(),
            done: all.filter((t) => t.status === 'COMPLETED').length,
            problems: all.filter((t) => t.status === 'PROBLEM').length,
            notFound: all.filter((t) => t.status === 'NOT_FOUND').length,
            workerNotes: order.workerNotes,
            orderUrl: `${origin ?? ''}/auftraege/${order.id}`
          });
          sendMail({ to: owner.email, ...mail }).catch((e) => console.error('email failed', e));
        } catch (e) {
          // Never fail the status update due to notification issues.
          console.error('work order completion notification failed', e);
        }
      }
    }
  } else {
    await db
      .update(workOrders)
      .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
      .where(and(eq(workOrders.id, assignment.workOrderId), eq(workOrders.status, 'OPEN')));
  }

  publish(channelFor('work-order', assignment.workOrderId), { type: 'tree-updated' });
  return { ok: true };
});
