import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { listParcelsInBbox } from '$lib/server/bayernatlas';

const bboxSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()])
});

export const parcelsInBbox = query('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = bboxSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  try {
    const features = await listParcelsInBbox(parsed.data.bbox);
    return { features };
  } catch (e) {
    throw error(400, e instanceof Error ? e.message : 'BayernAtlas-Abfrage fehlgeschlagen.');
  }
});
