# Deployment

Single-VPS deployment with Docker Compose + Caddy.

## Prerequisites

- VPS with Docker and Docker Compose installed.
- A domain name pointing its `A`/`AAAA` records at the VPS public IP.
- Ports `80` and `443` open on the firewall (Caddy handles Let's Encrypt on boot).

## First-time setup

```bash
git clone <repo> waldmeister && cd waldmeister
cp .env.example .env
$EDITOR .env   # set DOMAIN, ACME_EMAIL, BETTER_AUTH_SECRET (openssl rand -base64 32), S3 creds, SMTP creds

docker compose build
docker compose up -d
docker compose logs -f app   # watch the migration run and the app start
```

On first boot Caddy requests a Let's Encrypt certificate for `$DOMAIN` — this takes up to a minute. Once the `caddy` container logs `certificate obtained successfully`, browse to `https://$DOMAIN`.

## Database migrations

The app container runs `bun ./scripts/migrate.ts` on every start. Migration files live in `./drizzle/` and are applied once (tracked in the `_migrations` table).

To add a new migration:

1. Edit `src/lib/server/db/schema.ts`.
2. `bun run db:generate` — Drizzle Kit writes a new `.sql` file to `drizzle/`.
3. Commit and redeploy (`docker compose up -d --build`).

## Backups

PostgreSQL data lives in the `pgdata` named volume. Simple nightly dump:

```bash
docker compose exec -T db pg_dump -U waldmeister waldmeister | gzip > backup-$(date +%F).sql.gz
```

Object storage (S3/R2) is managed by the provider — no VPS-side backup needed.

## Updates

```bash
git pull
docker compose build app
docker compose up -d app
```

Caddy and Postgres do not need to be rebuilt on app-only updates.

## Troubleshooting

- **`app` fails to start** — `docker compose logs app` typically surfaces missing env vars.
- **Caddy keeps redirecting to HTTP** — check `DOMAIN` is reachable from the public internet and ports 80/443 are open.
- **S3 presigning fails** — verify `S3_ENDPOINT`, credentials, and bucket name. For Cloudflare R2 leave `S3_REGION=auto` and set `S3_FORCE_PATH_STYLE=true`.
