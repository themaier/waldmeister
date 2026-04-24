import { getRequestEvent, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, accessRoutes } from '$lib/server/db/schema';
import { ROUTE_TYPES, VEHICLE_TYPES } from '$lib/enums';
import { and, eq } from 'drizzle-orm';
import { getPlotOverview } from './trees.remote';

// README §4.3 / §5.4 — Anfahrt + Rückegasse share this table. Path is a
// hand-drawn GeoJSON LineString in WGS84.
const createRouteSchema = z.object({
  plotId: z.string().uuid(),
  routeType: z.enum(ROUTE_TYPES),
  vehicleType: z.enum(VEHICLE_TYPES),
  name: z.string().trim().max(120).nullable().optional(),
  comment: z.string().trim().max(2000).nullable().optional(),
  pathData: z.object({
    type: z.literal('LineString'),
    coordinates: z
      .array(
        z
          .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
          // additional vertices accepted (z, m) but ignored downstream
          .rest(z.number())
      )
      .min(2, 'Linie muss mindestens zwei Punkte enthalten.')
  })
});

export const createRoute = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = createRouteSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const input = parsed.data;

  // README §4.3 constraint — Rückegassen are always Kleingerät only.
  // The UI also locks the dropdown; this is the server-side belt.
  if (input.routeType === 'rueckegasse' && input.vehicleType !== 'kleingerät') {
    throw error(400, 'Rückegassen sind immer nur für Kleingerät befahrbar.');
  }

  const [plot] = await db
    .select({ id: forestPlots.id })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, input.plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const [row] = await db
    .insert(accessRoutes)
    .values({
      plotId: input.plotId,
      routeType: input.routeType,
      vehicleType: input.vehicleType,
      name: input.name?.trim() || null,
      comment: input.comment?.trim() || null,
      pathData: input.pathData
    })
    .returning({ id: accessRoutes.id });

  // Drop the cached overview so the home map picks up the new route on
  // the next read without a full page reload.
  void getPlotOverview(input.plotId).refresh();

  return { routeId: row.id };
});

export const deleteRoute = command(z.string().uuid(), async (id) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  // access_routes has no owner_id of its own — authorize via the parent plot.
  const [route] = await db
    .select({ id: accessRoutes.id, plotId: accessRoutes.plotId })
    .from(accessRoutes)
    .innerJoin(forestPlots, eq(forestPlots.id, accessRoutes.plotId))
    .where(and(eq(accessRoutes.id, id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!route) throw error(404, 'Weg nicht gefunden.');

  await db.delete(accessRoutes).where(eq(accessRoutes.id, id));
  void getPlotOverview(route.plotId).refresh();
  return { ok: true };
});
