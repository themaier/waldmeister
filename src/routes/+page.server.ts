import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, parcels, forestPlotParcels, trees, accessRoutes } from '$lib/server/db/schema';
import { geomToGeoJson } from '$lib/server/db/geo';
import { eq, sql, inArray } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');

  const plots = await db
    .select({ id: forestPlots.id, name: forestPlots.name, createdAt: forestPlots.createdAt })
    .from(forestPlots)
    .where(eq(forestPlots.ownerId, locals.user.id))
    .orderBy(forestPlots.createdAt);

  const plotIds = plots.map((p) => p.id);

  // Load parcels (with GeoJSON geometry) for every plot in one round-trip.
  // Joins through forest_plot_parcels since parcels are now a global cache.
  const parcelRows = plotIds.length
    ? await db
        .select({
          id: parcels.id,
          plotId: forestPlotParcels.plotId,
          cadastralId: parcels.cadastralId,
          geometry: geomToGeoJson(parcels.geometry).as('geometry')
        })
        .from(forestPlotParcels)
        .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
        .where(inArray(forestPlotParcels.plotId, plotIds))
    : [];

  // Preload trees for the (future) active plot count — each plot gets a tree
  // count for the card view; tree geometry is loaded lazily per-plot later.
  const treeCounts = plotIds.length
    ? await db
        .select({
          plotId: trees.plotId,
          count: sql<number>`count(*)::int`.as('count')
        })
        .from(trees)
        .where(inArray(trees.plotId, plotIds))
        .groupBy(trees.plotId)
    : [];

  const routeCounts = plotIds.length
    ? await db
        .select({
          plotId: accessRoutes.plotId,
          count: sql<number>`count(*)::int`.as('count')
        })
        .from(accessRoutes)
        .where(inArray(accessRoutes.plotId, plotIds))
        .groupBy(accessRoutes.plotId)
    : [];

  const treesByPlot = Object.fromEntries(treeCounts.map((r) => [r.plotId, r.count]));
  const routesByPlot = Object.fromEntries(routeCounts.map((r) => [r.plotId, r.count]));

  return {
    plots: plots.map((p) => ({
      ...p,
      treeCount: treesByPlot[p.id] ?? 0,
      routeCount: routesByPlot[p.id] ?? 0
    })),
    parcels: parcelRows.map((row) => ({
      id: row.id,
      plotId: row.plotId,
      cadastralId: row.cadastralId,
      geometry: typeof row.geometry === 'string' ? JSON.parse(row.geometry) : row.geometry
    }))
  };
};
