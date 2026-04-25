import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, areas, trees } from '$lib/server/db/schema';
import { geoJsonToGeom } from '$lib/server/db/geo';
import { and, eq, sql } from 'drizzle-orm';
import { getPlotOverview } from './trees.remote';
import { HEALTH_STATUSES } from '$lib/enums';

// README §4.5 / §5.8 — a Bereich is a freehand polygon scribbled on the map.
// The drawing tool auto-closes the loop on finger-up, so the client always
// sends a valid GeoJSON Polygon (single ring, first == last vertex).
//
// `appliedTreeStatus` records the user's intent to bulk-apply a health status
// to every tree inside the polygon at submit time. When set, we run a single
// PostGIS-backed UPDATE in the same transaction.
const createAreaSchema = z.object({
  plotId: z.string().uuid(),
  comment: z.string().trim().max(2000).nullable().optional(),
  appliedTreeStatus: z.enum(HEALTH_STATUSES).nullable().optional(),
  geometry: z.object({
    type: z.literal('Polygon'),
    coordinates: z
      .array(
        z
          .array(
            z
              .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
              .rest(z.number())
          )
          .min(4, 'Polygon braucht mindestens drei Punkte.')
      )
      .min(1)
  })
});

export const createArea = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = createAreaSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const input = parsed.data;

  const [plot] = await db
    .select({ id: forestPlots.id })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, input.plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const status = input.appliedTreeStatus ?? null;
  const geomSql = geoJsonToGeom(input.geometry);

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(areas)
      .values({
        plotId: input.plotId,
        comment: input.comment?.trim() || null,
        appliedTreeStatus: status,
        geometry: geomSql as unknown as string
      })
      .returning({ id: areas.id });

    let appliedCount = 0;
    if (status) {
      // Bulk-apply the health status to every tree whose point falls inside
      // the polygon (README §5.8). Single transactional UPDATE; ST_Contains
      // uses the same geometry we just stored.
      const updated = await tx.execute(sql`
        UPDATE trees
        SET health_status = ${status}, updated_at = now()
        WHERE plot_id = ${input.plotId}
          AND ST_Contains(
            (SELECT geometry FROM areas WHERE id = ${row.id}),
            ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)
          )
      `);
      appliedCount = (updated as { rowCount?: number }).rowCount ?? 0;
    }
    return { areaId: row.id, appliedCount };
  });

  void getPlotOverview(input.plotId).refresh();
  return result;
});

export const deleteArea = command(z.string().uuid(), async (id) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  const [area] = await db
    .select({ id: areas.id, plotId: areas.plotId })
    .from(areas)
    .innerJoin(forestPlots, eq(forestPlots.id, areas.plotId))
    .where(and(eq(areas.id, id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!area) throw error(404, 'Bereich nicht gefunden.');

  await db.delete(areas).where(eq(areas.id, id));
  void getPlotOverview(area.plotId).refresh();
  return { ok: true };
});
