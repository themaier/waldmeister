import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
  workOrders,
  workOrderTrees,
  trees,
  treeImages,
  accessRoutes,
  plotImages,
  areas,
  forestPlots,
  parcels,
  forestPlotParcels
} from '$lib/server/db/schema';
import { and, eq, inArray, asc, sql } from 'drizzle-orm';
import { geomToGeoJson } from '$lib/server/db/geo';
import { presignDownload } from '$lib/server/s3';

interface Visibility {
  anfahrten: boolean;
  plot_photos: boolean;
  areas: boolean;
  tree_photos: boolean;
  tree_descriptions: boolean;
  tree_health: boolean;
}

/** Partial `share_visibility` JSON is merged with these defaults (full share). */
const DEFAULT_SHARE_VISIBILITY: Visibility = {
  anfahrten: true,
  plot_photos: true,
  areas: true,
  tree_photos: true,
  tree_descriptions: true,
  tree_health: true
};

export const load: PageServerLoad = async ({ params }) => {
  const [order] = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.shareToken, params.token))
    .limit(1);
  if (!order) throw error(404, 'Auftrag nicht gefunden.');
  if (order.shareExpiresAt && order.shareExpiresAt.getTime() < Date.now()) {
    throw error(410, 'Link abgelaufen. Bitte frage den Besitzer nach einem neuen Link.');
  }
  if (order.status === 'ARCHIVED') throw error(410, 'Auftrag archiviert.');

  const vis: Visibility = {
    ...DEFAULT_SHARE_VISIBILITY,
    ...(order.shareVisibility as Partial<Visibility>)
  };

  const wotRaw = await db
    .select({
      id: workOrderTrees.id,
      status: workOrderTrees.status,
      statusMessage: workOrderTrees.statusMessage,
      tree: trees
    })
    .from(workOrderTrees)
    .innerJoin(trees, eq(workOrderTrees.treeId, trees.id))
    .where(eq(workOrderTrees.workOrderId, order.id))
    // Without ORDER BY, Postgres order is undefined and can change after row updates.
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
        (a, b) => (treeOrderPos.get(a.tree.id) ?? 1e9) - (treeOrderPos.get(b.tree.id) ?? 1e9)
      )
    : wotRaw;

  const treeIds = wot.map((w) => w.tree.id);
  const selectedPlotId =
    selection.type === 'plot' || selection.type === 'areas'
      ? selection.plotId
      : null;
  const plotIdsFromTrees = [...new Set(wot.map((w) => w.tree.plotId).filter((id): id is string => !!id))];
  // Flurstücke: prefer plots from trees; fall back to selection Waldstück (e.g. all trees in one plot).
  const plotIds =
    plotIdsFromTrees.length > 0
      ? plotIdsFromTrees
      : selectedPlotId
        ? [selectedPlotId]
        : wot[0]?.tree.plotId
          ? [wot[0].tree.plotId]
          : [];
  const framingPlotId = selectedPlotId ?? plotIds[0] ?? null;

  const [imgs, routes, plotPhotos, areaRows, plotCenterRows] = await Promise.all([
    vis.tree_photos && treeIds.length
      ? db
          .select()
          .from(treeImages)
          .where(inArray(treeImages.treeId, treeIds))
          .orderBy(asc(treeImages.sortOrder))
      : [],
    vis.anfahrten && plotIds.length
      ? db.select().from(accessRoutes).where(inArray(accessRoutes.plotId, plotIds))
      : [],
    vis.plot_photos && plotIds.length
      ? db
          .select()
          .from(plotImages)
          .where(inArray(plotImages.plotId, plotIds))
          .orderBy(asc(plotImages.sortOrder))
      : [],
    vis.areas && plotIds.length
      ? db
          .select({
            id: areas.id,
            plotId: areas.plotId,
            comment: areas.comment,
            appliedTreeStatus: areas.appliedTreeStatus,
            geometry: geomToGeoJson(areas.geometry).as('geometry')
          })
          .from(areas)
          .where(inArray(areas.plotId, plotIds))
      : []
    ,
    framingPlotId
      ? db
          .select({
            plotId: forestPlotParcels.plotId,
            center: sql<string>`ST_AsGeoJSON(ST_PointOnSurface(ST_Union(${parcels.geometry})))`.as(
              'center'
            )
          })
          .from(forestPlotParcels)
          .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
          .where(eq(forestPlotParcels.plotId, framingPlotId))
          .groupBy(forestPlotParcels.plotId)
      : []
  ]);

  const [plotRows, parcelRows] = await Promise.all([
    plotIds.length ? db.select().from(forestPlots).where(inArray(forestPlots.id, plotIds)) : [],
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
      : []
  ]);

  type TreeImg = (typeof imgs)[number];
  const imagesByTree = new Map<string, TreeImg[]>();
  for (const img of imgs) {
    const arr = imagesByTree.get(img.treeId) ?? [];
    arr.push(img);
    imagesByTree.set(img.treeId, arr);
  }

  const visiblePlotPhotos = plotPhotos.filter((p) => p.showOnMap);
  const signedUrls = new Map<string, string>();
  const allKeys = [...imgs.map((i) => i.s3Key), ...visiblePlotPhotos.map((p) => p.s3Key)];
  await Promise.all(
    allKeys.map(async (key) => {
      signedUrls.set(key, await presignDownload(key));
    })
  );

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
    order: {
      id: order.id,
      title: order.title,
      instructions: order.instructions,
      status: order.status,
      visibility: vis,
      selection
    },
    plotCenter,
    trees: wot.map((w) => ({
      assignmentId: w.id,
      status: w.status,
      statusMessage: w.statusMessage,
      id: w.tree.id,
      plotId: w.tree.plotId,
      latitude: Number(w.tree.latitude),
      longitude: Number(w.tree.longitude),
      gpsAccuracyM: w.tree.gpsAccuracyM != null ? Number(w.tree.gpsAccuracyM) : null,
      healthStatus: vis.tree_health ? w.tree.healthStatus : null,
      labels: w.tree.labels,
      description: vis.tree_descriptions ? w.tree.description : null,
      treeTypeId: w.tree.treeTypeId,
      images: (imagesByTree.get(w.tree.id) ?? []).map((i) => ({
        url: signedUrls.get(i.s3Key)!,
        width: i.widthPx,
        height: i.heightPx
      }))
    })),
    routes: routes.map((r) => ({
      id: r.id,
      plotId: r.plotId,
      routeType: r.routeType,
      vehicleType: r.vehicleType,
      name: r.name,
      comment: r.comment,
      pathData: r.pathData
    })),
    plotPhotos: visiblePlotPhotos.map((p) => ({
      id: p.id,
      plotId: p.plotId,
      name: p.name,
      url: signedUrls.get(p.s3Key)!,
      latitude: p.latitude != null ? Number(p.latitude) : null,
      longitude: p.longitude != null ? Number(p.longitude) : null
    })),
    areas: areaRows.map((a) => ({
      ...a,
      geometry: typeof a.geometry === 'string' ? JSON.parse(a.geometry) : a.geometry
    })),
    plots: plotRows,
    plotParcels: parcelRows.map((r) => ({
      plotId: r.plotId,
      id: r.id,
      cadastralId: r.cadastralId,
      geometry: typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry
    }))
  };
};
