import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, trees, treeImages } from '$lib/server/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { publicUrl } from '$lib/server/s3';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) throw redirect(303, '/login');

  const [tree] = await db
    .select()
    .from(trees)
    .innerJoin(forestPlots, eq(trees.plotId, forestPlots.id))
    .where(and(eq(trees.id, params.id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!tree) throw error(404, 'Baum nicht gefunden.');

  const images = await db
    .select()
    .from(treeImages)
    .where(eq(treeImages.treeId, params.id))
    .orderBy(asc(treeImages.sortOrder));

  return {
    tree: {
      ...tree.trees,
      latitude: Number(tree.trees.latitude),
      longitude: Number(tree.trees.longitude),
      gpsAccuracyM: tree.trees.gpsAccuracyM != null ? Number(tree.trees.gpsAccuracyM) : null
    },
    plot: tree.forest_plots,
    images: images.map((i) => ({ ...i, url: publicUrl(i.s3Key) }))
  };
};
