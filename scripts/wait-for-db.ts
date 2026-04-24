// Poll the DB until it accepts connections (or fail after ~30s).
// Used by `bun run setup` so migrations don't race the DB container boot.

import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set — did you copy .env.example to .env?');
  process.exit(1);
}

const MAX_ATTEMPTS = 30;
const DELAY_MS = 1000;

for (let i = 1; i <= MAX_ATTEMPTS; i++) {
  const sql = postgres(url, { max: 1, connect_timeout: 2, idle_timeout: 1 });
  try {
    await sql`SELECT 1`;
    await sql.end({ timeout: 1 });
    console.log(`✓ DB reachable (after ${i} ${i === 1 ? 'attempt' : 'attempts'})`);
    process.exit(0);
  } catch {
    await sql.end({ timeout: 1 }).catch(() => {});
    if (i === MAX_ATTEMPTS) {
      console.error('✗ DB not reachable after 30s. Is Docker running? `bun run db:up`?');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }
}
