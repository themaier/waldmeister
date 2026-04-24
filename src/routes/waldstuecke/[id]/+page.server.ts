import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, forestPlotParcels, trees, accessRoutes, plotImages } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');

  const [plot] = await db
    .select()
    .from(forestPlots)
    .where(and(eq(forestPlots.id, params.id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const [pc, tc, rc, photoCount] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(forestPlotParcels).where(eq(forestPlotParcels.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(trees).where(eq(trees.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(accessRoutes).where(eq(accessRoutes.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(plotImages).where(eq(plotImages.plotId, plot.id))
  ]);

  return {
    plot,
    counts: {
      parcels: pc[0]?.c ?? 0,
      trees: tc[0]?.c ?? 0,
      routes: rc[0]?.c ?? 0,
      photos: photoCount[0]?.c ?? 0
    }
  };
};
