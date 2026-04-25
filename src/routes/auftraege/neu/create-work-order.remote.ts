import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, trees, areas, workOrders, workOrderTrees } from '$lib/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

const schema = z.object({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().max(5000).default(''),
  selection: z.discriminatedUnion('type', [
    z.object({ type: z.literal('plot'), plotId: z.string().uuid() }),
    z.object({
      type: z.literal('areas'),
      plotId: z.string().uuid(),
      areaIds: z.array(z.string().uuid()).min(1)
    }),
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

export const createWorkOrder = command('unchecked', async (raw: unknown) => {
  const { locals, url } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(raw);
  } catch (err) {
    throw error(400, err instanceof z.ZodError ? err.issues[0].message : 'Ungültige Eingabe.');
  }

  let treeIds: string[] = [];
  if (parsed.selection.type === 'plot') {
    const [plot] = await db
      .select({ id: forestPlots.id })
      .from(forestPlots)
      .where(and(eq(forestPlots.id, parsed.selection.plotId), eq(forestPlots.ownerId, locals.user.id)))
      .limit(1);
    if (!plot) throw error(404, 'Waldstück nicht gefunden.');
    const rows = await db.select({ id: trees.id }).from(trees).where(eq(trees.plotId, plot.id));
    treeIds = rows.map((r) => r.id);
  } else if (parsed.selection.type === 'areas') {
    const [plot] = await db
      .select({ id: forestPlots.id })
      .from(forestPlots)
      .where(and(eq(forestPlots.id, parsed.selection.plotId), eq(forestPlots.ownerId, locals.user.id)))
      .limit(1);
    if (!plot) throw error(404, 'Waldstück nicht gefunden.');

    const areaRows = await db
      .select({ id: areas.id })
      .from(areas)
      .where(and(eq(areas.plotId, plot.id), inArray(areas.id, parsed.selection.areaIds)));
    const areaIds = areaRows.map((r) => r.id);
    if (areaIds.length === 0) throw error(400, 'Keine gültigen Bereiche ausgewählt.');

    const matched = await db.execute(sql`
      SELECT DISTINCT t.id
      FROM trees t
      WHERE t.plot_id = ${plot.id}
        AND EXISTS (
          SELECT 1 FROM areas a
          WHERE a.id IN (${sql.join(
            areaIds.map((id) => sql`${id}`),
            sql`, `
          )})
            AND ST_Contains(
              a.geometry,
              ST_SetSRID(ST_MakePoint(t.longitude::float8, t.latitude::float8), 4326)
            )
        )
    `);
    treeIds = (matched as unknown as Array<{ id: string }>).map((r) => r.id);
    if (treeIds.length === 0) throw error(400, 'In den gewählten Bereichen liegen keine Bäume.');
  } else {
    const rows = await db
      .select({ id: trees.id })
      .from(trees)
      .innerJoin(forestPlots, eq(trees.plotId, forestPlots.id))
      .where(and(inArray(trees.id, parsed.selection.treeIds), eq(forestPlots.ownerId, locals.user.id)));
    treeIds = rows.map((r) => r.id);
    if (treeIds.length === 0) throw error(400, 'Keine gültigen Bäume ausgewählt.');
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
    .returning({ id: workOrders.id, shareToken: workOrders.shareToken });

  if (treeIds.length > 0) {
    await db
      .insert(workOrderTrees)
      .values(treeIds.map((id) => ({ workOrderId: order.id, treeId: id })));
  }

  return {
    orderId: order.id,
    shareUrl: `${url.origin}/a/${order.shareToken}`
  };
});
