import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
  workOrders,
  workOrderTrees,
  trees,
  parcels,
  forestPlotParcels,
  accessRoutes
} from '$lib/server/db/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { suggestPriority } from '$lib/priority';
import type { Priority } from '$lib/enums';
import { geomToGeoJson } from '$lib/server/db/geo';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const [order] = await db
    .select()
    .from(workOrders)
    .where(and(eq(workOrders.id, params.id), eq(workOrders.ownerId, locals.user!.id)))
    .limit(1);
  if (!order) throw error(404, 'Auftrag nicht gefunden.');

  const wotRaw = await db
    .select({
      id: workOrderTrees.id,
      status: workOrderTrees.status,
      statusMessage: workOrderTrees.statusMessage,
      treeId: trees.id,
      plotId: trees.plotId,
      healthStatus: trees.healthStatus,
      labels: trees.labels,
      latitude: trees.latitude,
      longitude: trees.longitude
    })
    .from(workOrderTrees)
    .innerJoin(trees, eq(workOrderTrees.treeId, trees.id))
    .where(eq(workOrderTrees.workOrderId, order.id))
    .orderBy(asc(trees.createdAt), asc(trees.id));

  const selection = order.selectionSnapshot as
    | { type: 'plot'; plotId: string }
    | { type: 'areas'; plotId: string; areaIds: string[] }
    | { type: 'trees'; treeIds: string[] };
  const treeOrderPos =
    selection.type === 'trees' && selection.treeIds.length > 0
      ? new Map(selection.treeIds.map((id, i) => [id, i]))
      : null;
  const wot = treeOrderPos
    ? [...wotRaw].sort(
        (a, b) => (treeOrderPos.get(a.treeId) ?? 1e9) - (treeOrderPos.get(b.treeId) ?? 1e9)
      )
    : wotRaw;

  const total = wot.length;
  const openDays = Math.floor((Date.now() - order.createdAt.getTime()) / (1000 * 60 * 60 * 24));
  const suggested = suggestPriority({
    totalTrees: total,
    infectedCount: wot.filter((t) => t.healthStatus === 'infected').length,
    deadCount: wot.filter((t) => t.healthStatus === 'dead').length,
    cutDownCount: wot.filter((t) => t.labels.includes('cut-down')).length,
    openDays,
    onlyCarelabels: wot.every(
      (t) => t.healthStatus !== 'infected' && t.healthStatus !== 'dead' && t.labels.every((l) => l !== 'cut-down')
    )
  });
  const effective = (order.userPriority ?? suggested) as Priority;

  const shareUrl = `${url.origin}/a/${order.shareToken}`;

  const plotIds = [...new Set(wot.map((t) => t.plotId))];
  const selectedPlotId = plotIds[0] ?? null;

  const [parcelRows, plotCenterRows, routeRows] = await Promise.all([
    plotIds.length
      ? db
          .select({
            id: parcels.id,
            plotId: forestPlotParcels.plotId,
            cadastralId: parcels.cadastralId,
            geometry: geomToGeoJson(parcels.geometry).as('geometry')
          })
          .from(forestPlotParcels)
          .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
          .where(inArray(forestPlotParcels.plotId, plotIds))
      : [],
    selectedPlotId
      ? db
          .select({
            plotId: forestPlotParcels.plotId,
            center: sql<string>`ST_AsGeoJSON(ST_PointOnSurface(ST_Union(${parcels.geometry})))`.as('center')
          })
          .from(forestPlotParcels)
          .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
          .where(eq(forestPlotParcels.plotId, selectedPlotId))
          .groupBy(forestPlotParcels.plotId)
      : [],
    plotIds.length
      ? db.select().from(accessRoutes).where(inArray(accessRoutes.plotId, plotIds))
      : []
  ]);

  const plotCenter =
    plotCenterRows.length && plotCenterRows[0]?.center
      ? (() => {
          try {
            const gj = JSON.parse(plotCenterRows[0].center) as {
              type: 'Point';
              coordinates: [number, number];
            };
            return gj?.type === 'Point' ? gj.coordinates : null;
          } catch {
            return null;
          }
        })()
      : null;

  return {
    order: { ...order, suggestedPriority: suggested, effectivePriority: effective },
    trees: wot.map((t) => ({
      ...t,
      latitude: Number(t.latitude),
      longitude: Number(t.longitude)
    })),
    plotParcels: parcelRows.map((r) => ({
      plotId: r.plotId,
      id: r.id,
      cadastralId: r.cadastralId,
      geometry: typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry
    })),
    routes: routeRows.map((r) => ({
      id: r.id,
      plotId: r.plotId,
      routeType: r.routeType,
      vehicleType: r.vehicleType,
      name: r.name,
      comment: r.comment,
      pathData: r.pathData
    })),
    plotCenter,
    shareUrl,
    counts: {
      total,
      completed: wot.filter((t) => t.status === 'COMPLETED').length,
      problem: wot.filter((t) => t.status === 'PROBLEM').length,
      notFound: wot.filter((t) => t.status === 'NOT_FOUND').length
    }
  };
};
