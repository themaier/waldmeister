// Seed a demo Waldstück so you can poke at the app without drawing a parcel.
//
//   bun run db:seed
//
// Register demo@waldmeister.local first if you want the data on the demo user.

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(url);

const EMAIL = 'demo@waldmeister.local';
const MOCK_PLOT_NAME = 'Unterreiner Forest';
const MOCK_CADASTRAL_ID = 'MOCK-UNTERREINER-FOREST-001';

// Irregular mock parcel matching the example coordinates from BayernAtlas.
// Input order is latitude, longitude; GeoJSON/PostGIS stores longitude,
// latitude in EPSG:4326.
const mockRingWgs84: Array<[number, number]> = [
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
];
const mockPolygonGeoJson = { type: 'Polygon', coordinates: [mockRingWgs84] };

async function main() {
  const [user] = await sql<{ id: string }[]>`
    SELECT id
    FROM "user"
    WHERE email = ${EMAIL}
    UNION ALL
    SELECT id
    FROM "user"
    WHERE NOT EXISTS (SELECT 1 FROM "user" WHERE email = ${EMAIL})
    ORDER BY id
    LIMIT 1
  `;
  if (!user) {
    console.log('No user found.');
    console.log(`→ Register at http://localhost:3000/register, then re-run: bun run db:seed`);
    await sql.end();
    return;
  }

  const existing = await sql<{ id: string }[]>`
    SELECT id
    FROM forest_plots
    WHERE owner_id = ${user.id}
      AND name = ${MOCK_PLOT_NAME}
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(`${MOCK_PLOT_NAME} already exists — plot id: ${existing[0].id}`);
    await sql.end();
    return;
  }

  const [{ id: plotId }] = await sql<{ id: string }[]>`
    INSERT INTO forest_plots (owner_id, name)
    VALUES (${user.id}, ${MOCK_PLOT_NAME})
    RETURNING id
  `;

  const [{ id: parcelId }] = await sql<{ id: string }[]>`
    INSERT INTO parcels (cadastral_id, gemarkung, municipality, area_sqm, geometry, fetched_at)
    VALUES (
      ${MOCK_CADASTRAL_ID},
      'Unterreiner',
      'Pocking',
      ST_Area(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(mockPolygonGeoJson)}), 4326), 25832))::numeric(14, 2),
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(mockPolygonGeoJson)}), 4326),
      now()
    )
    ON CONFLICT (cadastral_id) DO UPDATE SET
      gemarkung = EXCLUDED.gemarkung,
      municipality = EXCLUDED.municipality,
      area_sqm = EXCLUDED.area_sqm,
      geometry = EXCLUDED.geometry,
      fetched_at = EXCLUDED.fetched_at
    RETURNING id
  `;

  await sql`
    INSERT INTO forest_plot_parcels (plot_id, parcel_id)
    VALUES (${plotId}, ${parcelId})
    ON CONFLICT DO NOTHING
  `;

  console.log(`✓ Seeded ${MOCK_PLOT_NAME}`);
  console.log(`  plot id:  ${plotId}`);
  console.log(`  parcel id: ${parcelId}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
