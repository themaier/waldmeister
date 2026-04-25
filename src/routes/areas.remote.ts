import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, areas } from '$lib/server/db/schema';
import { geoJsonToGeom } from '$lib/server/db/geo';
import { and, eq } from 'drizzle-orm';
import { getPlotOverview } from './trees.remote';

// README §4.5 — a Bereich is a freehand polygon scribbled on the map. The
// drawing tool auto-closes the loop on finger-up, so the client always sends
// a valid GeoJSON Polygon (single ring, first == last vertex).
const createAreaSchema = z.object({
  plotId: z.string().uuid(),
  comment: z.string().trim().max(2000).nullable().optional(),
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

  const [row] = await db
    .insert(areas)
    .values({
      plotId: input.plotId,
      comment: input.comment?.trim() || null,
      geometry: geoJsonToGeom(input.geometry) as unknown as string
    })
    .returning({ id: areas.id });

  void getPlotOverview(input.plotId).refresh();
  return { areaId: row.id };
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
