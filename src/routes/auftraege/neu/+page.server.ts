import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, trees, areas } from '$lib/server/db/schema';
import { geomToGeoJson } from '$lib/server/db/geo';
import { and, eq, inArray } from 'drizzle-orm';
import { HEALTH_STATUSES, TREE_TYPES, TREE_LABELS } from '$lib/enums';

export const load: PageServerLoad = async ({ locals }) => {
  const plotRows = await db
    .select({ id: forestPlots.id, name: forestPlots.name })
    .from(forestPlots)
    .where(eq(forestPlots.ownerId, locals.user!.id))
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
