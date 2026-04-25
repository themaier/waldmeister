import { getRequestEvent, command, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { boundaryStones, forestPlots } from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import {
  presignUpload,
  presignDownload,
  deleteObject,
  boundaryStoneImageKey
} from '$lib/server/s3';

const createSchema = z.object({
  plotId: z.string().uuid(),
  description: z.string().max(2000).default(''),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  gpsAccuracyM: z.number().min(0).nullable().optional(),
  contentType: z.string().default('image/jpeg'),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1)
});

export const createBoundaryStone = command('unchecked', async (raw: unknown) => {
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

  const key = boundaryStoneImageKey(locals.user.id, plot.id, crypto.randomUUID());

  const [row] = await db
    .insert(boundaryStones)
    .values({
      plotId: plot.id,
      s3Key: key,
      description: input.description.trim(),
      latitude: input.latitude != null ? String(input.latitude) : null,
      longitude: input.longitude != null ? String(input.longitude) : null,
      gpsAccuracyM: input.gpsAccuracyM != null ? String(input.gpsAccuracyM) : null,
      widthPx: input.widthPx,
      heightPx: input.heightPx
    })
    .returning({ id: boundaryStones.id });

  const contentType = (input.contentType && input.contentType.trim()) || 'image/jpeg';
  let uploadUrl = '';
  try {
    uploadUrl = await presignUpload(key, contentType);
  } catch (e) {
    console.warn('S3 presign failed (dev mode?):', (e as Error).message);
  }

  void getBoundaryStones(plot.id).refresh();
  return { id: row.id, uploadUrl, contentType };
});

export const updateBoundaryStone = command(
  'unchecked',
  async (raw: unknown) => {
    const { locals } = getRequestEvent();
    if (!locals.user) throw error(401, 'Nicht angemeldet.');
    const schema = z.object({
      id: z.string().uuid(),
      description: z.string().max(2000)
    });
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw error(400, parsed.error.issues[0].message);

    const [stone] = await db
      .select({ id: boundaryStones.id, plotId: boundaryStones.plotId })
      .from(boundaryStones)
      .innerJoin(forestPlots, eq(forestPlots.id, boundaryStones.plotId))
      .where(and(eq(boundaryStones.id, parsed.data.id), eq(forestPlots.ownerId, locals.user.id)))
      .limit(1);
    if (!stone) throw error(404, 'Grenzstein nicht gefunden.');

    await db
      .update(boundaryStones)
      .set({ description: parsed.data.description.trim(), updatedAt: new Date() })
      .where(eq(boundaryStones.id, stone.id));

    void getBoundaryStones(stone.plotId).refresh();
    return { ok: true };
  }
);

export const deleteBoundaryStone = command(z.string().uuid(), async (id) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  const [stone] = await db
    .select({ id: boundaryStones.id, plotId: boundaryStones.plotId, s3Key: boundaryStones.s3Key })
    .from(boundaryStones)
    .innerJoin(forestPlots, eq(forestPlots.id, boundaryStones.plotId))
    .where(and(eq(boundaryStones.id, id), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!stone) throw error(404, 'Grenzstein nicht gefunden.');

  await db.delete(boundaryStones).where(eq(boundaryStones.id, stone.id));
  try {
    await deleteObject(stone.s3Key);
  } catch (e) {
    console.warn('S3 delete failed:', (e as Error).message);
  }
  void getBoundaryStones(stone.plotId).refresh();
  return { ok: true };
});

export const getBoundaryStones = query(z.string().uuid(), async (plotId) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');

  const [plot] = await db
    .select({ id: forestPlots.id })
    .from(forestPlots)
    .where(and(eq(forestPlots.id, plotId), eq(forestPlots.ownerId, locals.user.id)))
    .limit(1);
  if (!plot) throw error(404, 'Waldstück nicht gefunden.');

  const rows = await db
    .select()
    .from(boundaryStones)
    .where(eq(boundaryStones.plotId, plotId))
    .orderBy(asc(boundaryStones.createdAt));

  const stones = await Promise.all(
    rows.map(async (r) => {
      let url = '';
      try {
        url = await presignDownload(r.s3Key);
      } catch (e) {
        console.warn('S3 presign download failed:', (e as Error).message);
      }
      return {
        id: r.id,
        description: r.description,
        latitude: r.latitude != null ? Number(r.latitude) : null,
        longitude: r.longitude != null ? Number(r.longitude) : null,
        gpsAccuracyM: r.gpsAccuracyM != null ? Number(r.gpsAccuracyM) : null,
        widthPx: r.widthPx,
        heightPx: r.heightPx,
        takenAt: r.takenAt.toISOString(),
        url
      };
    })
  );

  return stones;
});
