import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import {
  forestPlots,
  forestPlotParcels,
  trees,
  accessRoutes,
  plotImages,
  boundaryStones
} from '$lib/server/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { presignDownload } from '$lib/server/s3';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');

  const [plot] = await db
    .select()
    .from(forestPlots)
    .where(and(eq(forestPlots.id, params.id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const [pc, tc, rc, photoCount, stoneRows] = await Promise.all([
    db.select({ c: sql<number>`count(*)::int` }).from(forestPlotParcels).where(eq(forestPlotParcels.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(trees).where(eq(trees.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(accessRoutes).where(eq(accessRoutes.plotId, plot.id)),
    db.select({ c: sql<number>`count(*)::int` }).from(plotImages).where(eq(plotImages.plotId, plot.id)),
    db
      .select()
      .from(boundaryStones)
      .where(eq(boundaryStones.plotId, plot.id))
      .orderBy(asc(boundaryStones.createdAt))
  ]);

  const stones = await Promise.all(
    stoneRows.map(async (s) => {
      let url = '';
      try {
        url = await presignDownload(s.s3Key);
      } catch (e) {
        console.warn('S3 presign failed:', (e as Error).message);
      }
      return {
        id: s.id,
        description: s.description,
        latitude: s.latitude != null ? Number(s.latitude) : null,
        longitude: s.longitude != null ? Number(s.longitude) : null,
        gpsAccuracyM: s.gpsAccuracyM != null ? Number(s.gpsAccuracyM) : null,
        widthPx: s.widthPx,
        heightPx: s.heightPx,
        takenAt: s.takenAt.toISOString(),
        url
      };
    })
  );

  return {
    plot,
    counts: {
      parcels: pc[0]?.c ?? 0,
      trees: tc[0]?.c ?? 0,
      routes: rc[0]?.c ?? 0,
      photos: photoCount[0]?.c ?? 0,
      stones: stones.length
    },
    boundaryStones: stones
  };
};
