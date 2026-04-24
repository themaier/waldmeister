import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { workOrders } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { PRIORITIES } from '$lib/enums';
import { publish, channelFor } from '$lib/server/sse';

const patchSchema = z
  .object({
    id: z.string().uuid(),
    userPriority: z.enum(PRIORITIES).nullable().optional(),
    extendExpiryDays: z.number().int().nullable().optional(),
    revokeLink: z.boolean().optional(),
    status: z.enum(['OPEN', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED']).optional(),
    shareVisibility: z
      .object({
        anfahrten: z.boolean().optional(),
        plot_photos: z.boolean().optional(),
        areas: z.boolean().optional(),
        tree_photos: z.boolean().optional(),
        tree_descriptions: z.boolean().optional(),
        tree_health: z.boolean().optional()
      })
      .optional()
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'id'), { message: 'Leerer Patch.' });

export const patchWorkOrder = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const input = parsed.data;

  const [existing] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, input.id), eq(workOrders.ownerId, locals.user.id)))
    .limit(1);
  if (!existing) throw error(404, 'Auftrag nicht gefunden.');

  const update: Record<string, unknown> = { updatedAt: new Date() };

  if ('userPriority' in input) update.userPriority = input.userPriority ?? null;
  if (input.status) update.status = input.status;
  if (input.shareVisibility) {
    update.shareVisibility = { ...(existing.shareVisibility as object), ...input.shareVisibility };
  }
  if ('extendExpiryDays' in input) {
    if (input.extendExpiryDays === null) {
      update.shareExpiresAt = null;
    } else if (typeof input.extendExpiryDays === 'number') {
      const base = existing.shareExpiresAt ?? new Date();
      const next = new Date(base);
      next.setDate(next.getDate() + input.extendExpiryDays);
      update.shareExpiresAt = next;
    }
  }
  if (input.revokeLink) {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const token = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 32);
    update.shareToken = token;
    update.shareExpiresAt = new Date();
  }

  await db.update(workOrders).set(update).where(eq(workOrders.id, input.id));
  publish(channelFor('work-order', input.id), { type: 'update' });
  return { ok: true };
});
