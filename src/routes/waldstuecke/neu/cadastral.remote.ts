import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

const bboxSchema = z.object({
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()])
});

// Hardcoded mock Flurstück used while the LDBV WFS is unreachable.
// Coordinates are GeoJSON [lon, lat]. The four corners the user provided
// are walked D→C→B→A so the ring is simple (non-self-intersecting).
const MOCK_CADASTRAL_ID = 'MOCK-0001';
const MOCK_GEOMETRY: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [12.91603, 48.26037],
      [12.91572, 48.26013],
      [12.91690, 48.25966],
      [12.91708, 48.25998],
      [12.91603, 48.26037]
    ]
  ]
};
const MOCK_BOUNDS = {
  minLon: 12.91572,
  maxLon: 12.91708,
  minLat: 48.25966,
  maxLat: 48.26037
};

async function upsertMock() {
  await db.execute(sql`
    INSERT INTO parcels (cadastral_id, gemarkung, municipality, area_sqm, geometry, fetched_at)
    VALUES (
      ${MOCK_CADASTRAL_ID},
      ${'Mock-Gemarkung'},
      ${null},
      ${null},
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(MOCK_GEOMETRY)}), 4326),
      now()
    )
    ON CONFLICT (cadastral_id) DO UPDATE SET
      geometry = EXCLUDED.geometry,
      fetched_at = EXCLUDED.fetched_at
  `);
}

function intersectsMock(bbox: [number, number, number, number]): boolean {
  const [w, s, e, n] = bbox;
  return !(e < MOCK_BOUNDS.minLon || w > MOCK_BOUNDS.maxLon || n < MOCK_BOUNDS.minLat || s > MOCK_BOUNDS.maxLat);
}

export const parcelsInBbox = query('unchecked', async (raw: unknown) => {
  const { locals } = getRequestEvent();
  if (!locals.user) throw error(401, 'Nicht angemeldet.');
  const parsed = bboxSchema.safeParse(raw);
  if (!parsed.success) throw error(400, parsed.error.issues[0].message);

  await upsertMock();

  if (!intersectsMock(parsed.data.bbox)) {
    return { features: [] };
  }
  return {
    features: [
      {
        id: MOCK_CADASTRAL_ID,
        cadastralId: MOCK_CADASTRAL_ID,
        gemarkung: 'Mock-Gemarkung',
        municipality: null,
        areaSqm: null,
        geometry: MOCK_GEOMETRY
      }
    ]
  };
});
