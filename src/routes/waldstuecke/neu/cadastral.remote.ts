import { getRequestEvent, query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { tracePolygonAt } from '$lib/server/parcelTrace';
import { sql } from 'drizzle-orm';

const bboxSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()])
});

type ParcelRow = {
  id: string;
  cadastral_id: string;
  geometry: string;
  taken_plot_id: string | null;
  taken_plot_name: string | null;
};

export const parcelsInBbox = query('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = bboxSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);

  const [w, s, e, n] = parsed.data.bbox;

  // DISTINCT ON (p.id) collapses the left-join fan-out so each parcel
  // appears once; NULLS LAST preferentially keeps the row that identifies
  // a plot the current user owns.
  const rows = await db.execute<ParcelRow>(sql`
    SELECT DISTINCT ON (p.id)
      p.id::text               AS id,
      p.cadastral_id           AS cadastral_id,
      ST_AsGeoJSON(p.geometry) AS geometry,
      fp.id::text              AS taken_plot_id,
      fp.name                  AS taken_plot_name
    FROM parcels p
    LEFT JOIN forest_plot_parcels fpp ON fpp.parcel_id = p.id
    LEFT JOIN forest_plots fp
      ON fp.id = fpp.plot_id AND fp.owner_id = ${locals.user.id}
    WHERE p.geometry && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
    ORDER BY p.id, fp.id NULLS LAST
  `);

  const features = rows.map((r) => ({
    id: r.id,
    cadastralId: r.cadastral_id,
    geometry: JSON.parse(r.geometry) as GeoJSON.Polygon | GeoJSON.MultiPolygon,
    takenBy: r.taken_plot_id ? { plotId: r.taken_plot_id, plotName: r.taken_plot_name } : null
  }));

  return { features };
});

const traceSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90)
});

export const traceParcelAt = command('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = traceSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);
  const { lng, lat } = parsed.data;

  // If an existing parcel already contains this point, reuse it — tracing
  // the same shape twice would create a duplicate polygon with a different
  // generated cadastral id.
  const existing = await db.execute<{ cadastral_id: string }>(sql`
    SELECT cadastral_id
    FROM parcels
    WHERE ST_Contains(geometry, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326))
    LIMIT 1
  `);
  if (existing[0]) return { cadastralId: existing[0].cadastral_id };

  let ring: [number, number][];
  try {
    ring = await tracePolygonAt(lng, lat);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw error(422, msg);
  }
  if (ring.length < 4) throw error(422, 'Parzelle konnte nicht erkannt werden.');

  const geometry: GeoJSON.Polygon = { type: 'Polygon', coordinates: [ring] };
  const cadastralId = `TRACED-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  await db.execute(sql`
    INSERT INTO parcels (cadastral_id, gemarkung, municipality, area_sqm, geometry, fetched_at)
    VALUES (
      ${cadastralId},
      NULL,
      NULL,
      NULL,
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geometry)}), 4326),
      now()
    )
  `);

  return { cadastralId };
});
