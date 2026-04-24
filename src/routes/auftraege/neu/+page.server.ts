import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, trees, workOrders, workOrderTrees } from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  const plots = await db
    .select({ id: forestPlots.id, name: forestPlots.name })
    .from(forestPlots)
    .where(eq(forestPlots.ownerId, locals.user.id))
    .orderBy(forestPlots.createdAt);
  return { plots };
};

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().max(5000).default(''),
  selection: z.discriminatedUnion('type', [
    z.object({ type: z.literal('plot'), plotId: z.string().uuid() }),
    z.object({ type: z.literal('trees'), treeIds: z.array(z.string().uuid()).min(1) })
  ]),
  visibility: z.object({
    anfahrten: z.boolean().default(true),
    plot_photos: z.boolean().default(true),
    areas: z.boolean().default(true),
    tree_photos: z.boolean().default(true),
    tree_descriptions: z.boolean().default(false),
    tree_health: z.boolean().default(true)
  })
});

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
}

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, '/login');
    const form = await request.formData();
    const raw = form.get('payload');
    if (typeof raw !== 'string') return fail(400, { error: 'Ungültige Eingabe.' });
    let parsed;
    try {
      parsed = schema.parse(JSON.parse(raw));
    } catch (err) {
      return fail(400, { error: err instanceof z.ZodError ? err.errors[0].message : 'Ungültige Eingabe.' });
    }

    // Resolve the selection into a tree-id list (scoped to the current user).
    let treeIds: string[] = [];
    if (parsed.selection.type === 'plot') {
      const [plot] = await db
        .select({ id: forestPlots.id })
        .from(forestPlots)
        .where(and(eq(forestPlots.id, parsed.selection.plotId), eq(forestPlots.ownerId, locals.user.id)))
        .limit(1);
      if (!plot) return fail(404, { error: 'Waldstück nicht gefunden.' });
      const rows = await db.select({ id: trees.id }).from(trees).where(eq(trees.plotId, plot.id));
      treeIds = rows.map((r) => r.id);
    } else {
      const rows = await db
        .select({ id: trees.id })
        .from(trees)
        .innerJoin(forestPlots, eq(trees.plotId, forestPlots.id))
        .where(and(inArray(trees.id, parsed.selection.treeIds), eq(forestPlots.ownerId, locals.user.id)));
      treeIds = rows.map((r) => r.id);
      if (treeIds.length === 0) return fail(400, { error: 'Keine gültigen Bäume ausgewählt.' });
    }

    const shareExpiresAt = new Date();
    shareExpiresAt.setDate(shareExpiresAt.getDate() + 30);

    const [order] = await db
      .insert(workOrders)
      .values({
        ownerId: locals.user.id,
        shareToken: randomToken(),
        shareExpiresAt,
        title: parsed.title,
        instructions: parsed.instructions,
        selectionSnapshot: parsed.selection,
        shareVisibility: parsed.visibility
      })
      .returning({ id: workOrders.id });

    await db
      .insert(workOrderTrees)
      .values(treeIds.map((id) => ({ workOrderId: order.id, treeId: id })));

    throw redirect(303, `/auftraege/${order.id}`);
  }
};
