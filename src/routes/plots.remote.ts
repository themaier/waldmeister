import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots } from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';

const renameSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().max(120).nullable().optional()
});

export const renamePlot = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = renameSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);

  const res = await db
    .update(forestPlots)
    .set({ name: parsed.data.name ?? null, updatedAt: new Date() })
    .where(and(eq(forestPlots.id, parsed.data.id), eq(forestPlots.ownerId, locals.user.id)))
    .returning({ id: forestPlots.id });
  if (res.length === 0) throw error(404, 'Waldstück nicht gefunden.');
  return { ok: true };
});

export const deletePlot = command(z.string().uuid(), async (id) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  const res = await db
    .delete(forestPlots)
    .where(and(eq(forestPlots.id, id), eq(forestPlots.ownerId, locals.user.id)))
    .returning({ id: forestPlots.id });
  if (res.length === 0) throw error(404, 'Waldstück nicht gefunden.');
  return { ok: true };
});
