// Seed a demo user + a small Waldstück so you can poke at the app without
// having to draw your first forest.
//
//   bun run db:seed
//
// Login: demo@waldmeister.local / waldmeister

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const sql = postgres(url);

const EMAIL = 'demo@waldmeister.local';
const PASSWORD_HASH =
  // better-auth uses scrypt; we let the user sign in via /register instead to
  // keep seed scripts free of crypto coupling. This seed only creates demo
  // forest data once a user exists. So first: register at /register manually,
  // then re-run `bun run db:seed` to attach demo data to that user.
  null;

async function main() {
  const [user] = await sql<{ id: string }[]>`SELECT id FROM "user" WHERE email = ${EMAIL} LIMIT 1`;
  if (!user) {
    console.log(`No user with email ${EMAIL} yet.`);
    console.log(`→ Register at http://localhost:3000/register with that email,`);
    console.log(`  then re-run:  bun run db:seed`);
    await sql.end();
    return;
  }

  // Idempotent: skip if the demo plot is already present.
  const existing = await sql`SELECT id FROM forest_plots WHERE owner_id = ${user.id} AND name = 'Demo-Wald' LIMIT 1`;
  if (existing.length > 0) {
    console.log('Demo-Wald already exists — nothing to do.');
    await sql.end();
    return;
  }

  const [{ id: plotId }] = await sql<{ id: string }[]>`
    INSERT INTO forest_plots (owner_id, name)
    VALUES (${user.id}, 'Demo-Wald')
    RETURNING id
  `;

  // One polygon somewhere near München.
  const ring = [
    [11.5, 48.14],
    [11.51, 48.14],
    [11.51, 48.145],
    [11.5, 48.145],
    [11.5, 48.14]
  ];
  await sql`
    INSERT INTO parcels (plot_id, cadastral_id, geometry)
    VALUES (
      ${plotId},
      'DEMO-001',
      ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: 'Polygon', coordinates: [ring] })}), 4326)
    )
  `;

  // Scatter 6 trees inside.
  const trees = [
    { lat: 48.141, lng: 11.502, type: 'fichte', health: 'healthy' },
    { lat: 48.142, lng: 11.504, type: 'fichte', health: 'must-watch' },
    { lat: 48.143, lng: 11.503, type: 'tanne', health: 'infected' },
    { lat: 48.144, lng: 11.505, type: 'eiche', health: 'healthy' },
    { lat: 48.142, lng: 11.507, type: 'kiefer', health: 'dead' },
    { lat: 48.141, lng: 11.506, type: 'buche', health: 'healthy' }
  ];
  for (const t of trees) {
    await sql`
      INSERT INTO trees (plot_id, latitude, longitude, gps_accuracy_m, tree_type_id, health_status, labels)
      VALUES (${plotId}, ${t.lat}, ${t.lng}, 5, ${t.type}, ${t.health}, '{}')
    `;
  }

  console.log(`✓ Seeded Demo-Wald (${plotId}) with ${trees.length} trees.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
