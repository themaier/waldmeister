import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';

const DEFAULT_PLOT_NAME = 'Unterreiner Forest';
const DEFAULT_CADASTRAL_ID = 'MOCK-UNTERREINER-FOREST-001';

// Example Waldstück used for local testing. Input came as latitude/longitude,
// but GeoJSON stores longitude/latitude in EPSG:4326.
const UNTERREINER_FOREST_GEOJSON = {
  type: 'Polygon',
  coordinates: [[
    [12.99315, 48.26677],
    [12.9942, 48.26695],
    [12.99361, 48.26802],
    [12.99305, 48.26892],
    [12.99181, 48.26959],
    [12.99002, 48.2704],
    [12.98802, 48.27097],
    [12.98762, 48.27083],
    [12.98891, 48.27025],
    [12.99044, 48.26961],
    [12.99129, 48.26915],
    [12.99184, 48.26847],
    [12.99263, 48.26766],
    [12.99275, 48.26709],
    [12.99315, 48.26677]
  ]]
} as const;

const ensuredUserIds = new Set<string>();

export async function ensureDefaultPlotForUser(userId: string): Promise<void> {
  if (ensuredUserIds.has(userId)) return;

  const geometryJson = JSON.stringify(UNTERREINER_FOREST_GEOJSON);
  await db.execute(sql`
    WITH parcel AS (
      INSERT INTO parcels (cadastral_id, gemarkung, municipality, area_sqm, geometry, fetched_at)
      VALUES (
        ${DEFAULT_CADASTRAL_ID},
        'Unterreiner',
        'Pocking',
        ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326), 25832))::numeric(14, 2),
        ST_SetSRID(ST_GeomFromGeoJSON(${geometryJson}), 4326),
        now()
      )
      ON CONFLICT (cadastral_id) DO UPDATE SET
        gemarkung = EXCLUDED.gemarkung,
        municipality = EXCLUDED.municipality,
        area_sqm = EXCLUDED.area_sqm,
        geometry = EXCLUDED.geometry,
        fetched_at = EXCLUDED.fetched_at
      RETURNING id
    ),
    plot AS (
      INSERT INTO forest_plots (owner_id, name)
      SELECT ${userId}, ${DEFAULT_PLOT_NAME}
      WHERE NOT EXISTS (
        SELECT 1
        FROM forest_plots
        WHERE owner_id = ${userId}
          AND name = ${DEFAULT_PLOT_NAME}
      )
      RETURNING id
    ),
    selected_plot AS (
      SELECT id FROM plot
      UNION ALL
      SELECT id
      FROM forest_plots
      WHERE owner_id = ${userId}
        AND name = ${DEFAULT_PLOT_NAME}
      LIMIT 1
    )
    INSERT INTO forest_plot_parcels (plot_id, parcel_id)
    SELECT selected_plot.id, parcel.id
    FROM selected_plot, parcel
    ON CONFLICT DO NOTHING
  `);

  ensuredUserIds.add(userId);
}
