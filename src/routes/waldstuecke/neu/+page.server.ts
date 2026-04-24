import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { forestPlots, forestPlotParcels, parcels } from '$lib/server/db/schema';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveParcelIds } from '$lib/server/bayernatlas';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) throw redirect(303, '/login');
  return {};
};

// Two channels of selection are accepted:
//   1. `cadastralIds` — real ALKIS parcels already in the `parcels` cache
//      (populated via the LDBV WFS when credentials are configured).
//   2. `manualParcels` — polygons the user traced over the raster overlay
//      when the WFS is unreachable. These are persisted with a synthetic
//      `manual:<uuid>` cadastral_id so they coexist with real cache rows
//      under the same UNIQUE(cadastral_id) constraint.
const schema = z
  .object({
    name: z.string().trim().max(120).optional(),
    cadastralIds: z.array(z.string().min(1)).default([]),
    manualParcels: z
      .array(
        z.object({
          geometry: z.object({
            type: z.literal('Polygon'),
            coordinates: z.array(z.array(z.tuple([z.number(), z.number()])))
          })
        })
      )
      .default([])
  })
  .refine(
    (v) => v.cadastralIds.length + v.manualParcels.length >= 1,
    { message: 'Mindestens ein Flurstück auswählen oder zeichnen.' }
  );

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) throw redirect(303, '/login');

    const form = await request.formData();
    const raw = form.get('payload');
    if (typeof raw !== 'string') return fail(400, { error: 'Ungültige Eingabe.' });

    let parsed;
    try {
      parsed = schema.parse(JSON.parse(raw));
    } catch (err) {
      return fail(400, { error: err instanceof z.ZodError ? err.errors[0].message : 'Ungültige Eingabe.' });
    }

    // Resolve real ALKIS parcels from the cache.
    const ids = Array.from(new Set(parsed.cadastralIds));
    const resolved = await resolveParcelIds(ids);
    const missing = ids.filter((id) => !resolved.has(id));
    if (missing.length > 0) {
      return fail(400, {
        error: `Flurstück${missing.length === 1 ? '' : 'e'} ${missing.join(', ')} nicht im Cache. Bitte Karte neu laden.`
      });
    }

    const [plot] = await db
      .insert(forestPlots)
      .values({ ownerId: locals.user.id, name: parsed.name || null })
      .returning({ id: forestPlots.id });

    const linkParcelIds: string[] = Array.from(resolved.values());

    // Manual-drawn polygons: upsert into `parcels` with synthetic cadastral_id.
    for (const m of parsed.manualParcels) {
      const synthetic = `manual:${crypto.randomUUID()}`;
      const [row] = await db
        .insert(parcels)
        .values({
          cadastralId: synthetic,
          gemarkung: null,
          municipality: null,
          areaSqm: null,
          geometry: sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(m.geometry)}), 4326)` as unknown as string
        })
        .returning({ id: parcels.id });
      linkParcelIds.push(row.id);
    }

    await db
      .insert(forestPlotParcels)
      .values(linkParcelIds.map((parcelId) => ({ plotId: plot.id, parcelId })));

    throw redirect(303, `/?plot=${plot.id}`);
  }
};
