# syntax=docker/dockerfile:1.7
# Multi-stage build: compile SvelteKit with Bun, run on Bun slim image.

# ---------- deps ----------
FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile 2>/dev/null || bun install

# ---------- build ----------
FROM oven/bun:1.1-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Svelte check is optional here; skip for faster CI.
RUN bun run build

# ---------- runtime ----------
FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Only copy what we need to run.
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/server/db ./src/lib/server/db

EXPOSE 3000

# Run DB migrations then start the app. Fails loudly if DB is not reachable.
CMD ["sh", "-c", "bun ./scripts/migrate.ts && bun ./build/index.js"]
