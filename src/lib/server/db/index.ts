import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

type DB = ReturnType<typeof drizzle<typeof schema>>;

let _db: DB | null = null;
let _client: postgres.Sql | null = null;

function connect(): DB {
  if (_db) return _db;
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  _client = postgres(url, { max: 20, idle_timeout: 30 });
  _db = drizzle(_client, { schema });
  return _db;
}

// Proxy so importers can use `db` synchronously while the connection is
// created on first actual use — safe for Vite's SSR build step.
export const db = new Proxy({} as DB, {
  get(_t, prop: keyof DB) {
    const d = connect();
    const v = d[prop];
    return typeof v === 'function' ? v.bind(d) : v;
  }
});

export { schema };
export type { DB };
