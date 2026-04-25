import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, trees, areas, workOrders, workOrderTrees } from '$lib/server/db/schema';
import { geomToGeoJson } from '$lib/server/db/geo';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HEALTH_STATUSES, TREE_TYPES, TREE_LABELS } from '$lib/enums';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  const plotRows = await db
    .select({ id: forestPlots.id, name: forestPlots.name })
    .from(forestPlots)
    .where(eq(forestPlots.ownerId, locals.user.id))
    .orderBy(forestPlots.createdAt);

  if (plotRows.length === 0) {
    return { plots: [] as Array<{ id: string; name: string | null; trees: never[]; areas: never[] }> };
  }

  const plotIds = plotRows.map((p) => p.id);

  const [treeRows, areaRows] = await Promise.all([
    db
      .select({
        id: trees.id,
        plotId: trees.plotId,
        latitude: trees.latitude,
        longitude: trees.longitude,
        treeTypeId: trees.treeTypeId,
        healthStatus: trees.healthStatus,
        labels: trees.labels
      })
      .from(trees)
      .where(inArray(trees.plotId, plotIds))
      .orderBy(trees.createdAt),
    db
      .select({
        id: areas.id,
        plotId: areas.plotId,
        comment: areas.comment,
        appliedTreeStatus: areas.appliedTreeStatus,
        geometry: geomToGeoJson(areas.geometry).as('geometry')
      })
      .from(areas)
      .where(inArray(areas.plotId, plotIds))
      .orderBy(areas.createdAt)
  ]);

  type PlotTree = {
    id: string;
    latitude: number;
    longitude: number;
    treeTypeId: typeof TREE_TYPES[number];
    healthStatus: typeof HEALTH_STATUSES[number];
    labels: typeof TREE_LABELS[number][];
  };
  type PlotArea = {
    id: string;
    comment: string | null;
    appliedTreeStatus: typeof HEALTH_STATUSES[number] | null;
  };

  const treesByPlot = new Map<string, PlotTree[]>();
  for (const t of treeRows) {
    const list = treesByPlot.get(t.plotId) ?? [];
    list.push({
      id: t.id,
      latitude: Number(t.latitude),
      longitude: Number(t.longitude),
      treeTypeId: t.treeTypeId,
      healthStatus: t.healthStatus,
      labels: t.labels
    });
    treesByPlot.set(t.plotId, list);
  }

  const areasByPlot = new Map<string, PlotArea[]>();
  for (const a of areaRows) {
    const list = areasByPlot.get(a.plotId) ?? [];
    list.push({
      id: a.id,
      comment: a.comment,
      appliedTreeStatus: a.appliedTreeStatus
    });
    areasByPlot.set(a.plotId, list);
  }

  const plots = plotRows.map((p) => ({
    id: p.id,
    name: p.name,
    trees: treesByPlot.get(p.id) ?? [],
    areas: areasByPlot.get(p.id) ?? []
  }));

  return { plots };
};

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
      return fail(400, { error: err instanceof z.ZodError ? err.issues[0].message : 'Ungültige Eingabe.' });
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
    } else if (parsed.selection.type === 'areas') {
      const [plot] = await db
        .select({ id: forestPlots.id })
        .from(forestPlots)
        .where(and(eq(forestPlots.id, parsed.selection.plotId), eq(forestPlots.ownerId, locals.user.id)))
        .limit(1);
      if (!plot) return fail(404, { error: 'Waldstück nicht gefunden.' });

      const areaRows = await db
        .select({ id: areas.id })
        .from(areas)
        .where(and(eq(areas.plotId, plot.id), inArray(areas.id, parsed.selection.areaIds)));
      const areaIds = areaRows.map((r) => r.id);
      if (areaIds.length === 0) return fail(400, { error: 'Keine gültigen Bereiche ausgewählt.' });

      // PostGIS: a tree counts if it sits inside ANY of the chosen polygons.
      const matched = await db.execute(sql`
        SELECT DISTINCT t.id
        FROM trees t
        WHERE t.plot_id = ${plot.id}
          AND EXISTS (
            SELECT 1 FROM areas a
            WHERE a.id = ANY(${areaIds}::uuid[])
              AND ST_Contains(
                a.geometry,
                ST_SetSRID(ST_MakePoint(t.longitude::float8, t.latitude::float8), 4326)
              )
          )
      `);
      treeIds = (matched as unknown as Array<{ id: string }>).map((r) => r.id);
      if (treeIds.length === 0) return fail(400, { error: 'In den gewählten Bereichen liegen keine Bäume.' });
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
