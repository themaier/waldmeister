# Local development

The Docker setup for dev only runs Postgres/PostGIS. The SvelteKit app runs on the host via `bun run dev` so HMR, breakpoints, and IDE type checks work normally.

## First-time setup

```bash
# 1. Install deps (you've already done this if you ran `bun install`)
bun install

# 2. One-shot: copies .env.example → .env, starts Postgres in Docker,
#    waits for readiness, applies migrations.
bun run setup

# 3. Start the SvelteKit dev server
bun run dev
```

Open http://localhost:3000 — register an account at `/register`, then browse around.

## Everyday commands

| Command                  | What it does                                                                 |
| :----------------------- | :--------------------------------------------------------------------------- |
| `bun run dev`            | Start the Vite dev server on :3000                                           |
| `bun run check`          | Run `svelte-check` (type + Svelte errors)                                    |
| `bun run db:up`          | Start the DB container (detached)                                            |
| `bun run db:down`        | Stop the DB container (data is kept)                                         |
| `bun run db:logs`        | Tail DB logs                                                                 |
| `bun run db:reset`       | **Wipe** the DB volume and start fresh — you'll need to migrate + seed again |
| `bun run db:migrate`     | Apply every new `drizzle/*.sql` file                                         |
| `bun run db:studio`      | Open Drizzle Studio (GUI for the DB)                                         |
| `bun run db:generate`    | Regenerate migration SQL from `src/lib/server/db/schema.ts`                  |

## Adding a schema change

1. Edit `src/lib/server/db/schema.ts`.
2. `bun run db:generate` — Drizzle writes a new `drizzle/000N_*.sql`.
3. `bun run db:migrate` — apply it.

In a pinch during dev you can skip the migration file and push the schema directly with `bun run db:push`, but generate + migrate is what production uses.

## Troubleshooting

- **`db:up` errors with "Cannot connect to the Docker daemon"** — Docker Desktop isn't running. Start it, then retry.
- **`bun run dev` errors with `DATABASE_URL is not set`** — you're missing `.env`. Run `bun run env:init`.
- **Port 5432 already in use** — another Postgres is running on your machine. Either stop it, or edit `docker-compose.dev.yml` to publish on a different host port (e.g. `'5433:5432'`) and update `DATABASE_URL` in `.env` to match.
- **Register succeeds but every page redirects to `/login`** — your session cookie isn't set because `BETTER_AUTH_URL` doesn't match the URL you're actually browsing. The default `http://localhost:3000` works; if you changed the dev port, match it in `.env`.
