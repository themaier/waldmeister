// Simple migration runner: executes every .sql file under ./drizzle in order.
// Idempotent — each file is recorded in _migrations after success.

import postgres from 'postgres';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function run() {
  await sql`CREATE TABLE IF NOT EXISTS _migrations (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    applied_at timestamp NOT NULL DEFAULT now()
  )`;

  const dir = resolve(process.cwd(), 'drizzle');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const existing = await sql`SELECT 1 FROM _migrations WHERE name = ${file}`;
    if (existing.length > 0) {
      console.log(`· ${file} already applied`);
      continue;
    }
    console.log(`→ applying ${file}`);
    const body = readFileSync(join(dir, file), 'utf8');
    await sql.unsafe(body);
    await sql`INSERT INTO _migrations (name) VALUES (${file})`;
    console.log(`✓ ${file}`);
  }

  console.log('Migrations complete.');
  await sql.end();
}

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await sql.end();
  process.exit(1);
});
