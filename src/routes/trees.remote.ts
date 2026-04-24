import { getRequestEvent, query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { forestPlots, trees, treeImages, accessRoutes } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { presignUpload, treeImageKey } from '$lib/server/s3';
import { TREE_TYPES, HEALTH_STATUSES, TREE_LABELS } from '$lib/enums';

const createSchema = z.object({
  plotId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  gpsAccuracyM: z.number().min(0).nullable().optional(),
  treeTypeId: z.enum(TREE_TYPES),
  healthStatus: z.enum(HEALTH_STATUSES),
  labels: z.array(z.enum(TREE_LABELS)).default([]),
  estPlantedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  description: z.string().nullable().optional(),
  images: z
    .array(
      z.object({
        contentType: z.string().default('image/jpeg'),
        widthPx: z.number().int().min(1),
        heightPx: z.number().int().min(1)
      })
    )
    .min(1)
});

export const createTree = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const input = parsed.data;

  const [plot] = await db
    .select({ id: forestPlots.id })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, input.plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const parcelMatch = await db.execute(sql`
    SELECT p.id FROM parcels p
    INNER JOIN forest_plot_parcels fpp ON fpp.parcel_id = p.id
    WHERE fpp.plot_id = ${input.plotId}
      AND ST_Contains(p.geometry, ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326))
    LIMIT 1
  `);
  const parcelId = (parcelMatch[0] as { id?: string } | undefined)?.id ?? null;

  const [tree] = await db
    .insert(trees)
    .values({
      plotId: input.plotId,
      parcelId,
      latitude: String(input.latitude),
      longitude: String(input.longitude),
      gpsAccuracyM: input.gpsAccuracyM != null ? String(input.gpsAccuracyM) : null,
      treeTypeId: input.treeTypeId,
      healthStatus: input.healthStatus,
      labels: input.labels,
      estPlantedAt: input.estPlantedAt ?? null,
      description: input.description ?? null
    })
    .returning({ id: trees.id });

  const uploads: { index: number; url: string }[] = [];
  for (let i = 0; i < input.images.length; i++) {
    const img = input.images[i];
    const key = treeImageKey(locals.user.id, tree.id, crypto.randomUUID());
    await db.insert(treeImages).values({
      treeId: tree.id,
      s3Key: key,
      sortOrder: i,
      widthPx: img.widthPx,
      heightPx: img.heightPx
    });
    try {
      uploads.push({ index: i, url: await presignUpload(key, img.contentType) });
    } catch (e) {
      console.warn('S3 presign failed (dev mode?):', (e as Error).message);
      uploads.push({ index: i, url: '' });
    }
  }

  // Refresh the plot overview cache so the new tree appears.
  void getPlotOverview(input.plotId).refresh();

  return { treeId: tree.id, uploads };
});

export const getPlotOverview = query(z.string().uuid(), async (plotId) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  const plot = await db
    .select({ id: forestPlots.id })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (plot.length === 0) throw error(404, 'Waldstück nicht gefunden.');

  const [treeRows, routeRows] = await Promise.all([
    db
      .select({
        id: trees.id,
        latitude: trees.latitude,
        longitude: trees.longitude,
        gpsAccuracyM: trees.gpsAccuracyM,
        healthStatus: trees.healthStatus,
        labels: trees.labels,
        treeTypeId: trees.treeTypeId
      })
      .from(trees)
      .where(eq(trees.plotId, plotId)),
    db
      .select({
        id: accessRoutes.id,
        routeType: accessRoutes.routeType,
        vehicleType: accessRoutes.vehicleType,
        name: accessRoutes.name,
        comment: accessRoutes.comment,
        pathData: accessRoutes.pathData
      })
      .from(accessRoutes)
      .where(eq(accessRoutes.plotId, plotId))
  ]);

  return { trees: treeRows, routes: routeRows };
});
