// Basic Service Worker: pre-cache app shell, runtime-cache BayernAtlas tiles.
// The mutation queue + image IndexedDB live in $lib/offline (next phase).

/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-${version}`;
const TILE_CACHE = `tiles-v2`; // bumped when the base-map tile URL scheme changed

const APP_ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      await cache.addAll(APP_ASSETS);
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      for (const key of keys) {
        // Drop the current APP_CACHE siblings and any stale tile caches that
        // aren't the active TILE_CACHE — bumping TILE_CACHE's suffix is the
        // trigger when the base-map URL scheme changes.
        if (key !== APP_CACHE && key !== TILE_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Map tiles — cache-first, fallback to network. We only intercept tile
  // requests that carry WMS GetMap / XYZ-style signatures so the SW doesn't
  // accidentally swallow app-level requests (e.g. the WFS remote call).
  const isMapTile =
    url.hostname.includes('tile.openstreetmap.org') ||
    (url.hostname.includes('geoservices.bayern.de') && /request=GetMap/i.test(url.search));
  if (isMapTile) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        // On miss, go to network. Any error propagates — respondWith must
        // resolve to a Response, so we never return undefined here.
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      })()
    );
    return;
  }

  // App shell — cache-first for build/static assets.
  if (APP_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) => cache.match(req).then((r) => r ?? fetch(req)))
    );
  }
});
