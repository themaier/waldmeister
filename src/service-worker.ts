// Basic Service Worker: pre-cache app shell, runtime-cache BayernAtlas tiles.
// The mutation queue + image IndexedDB live in $lib/offline (next phase).

/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-${version}`;

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
        // Drop everything but the current app cache. The former tile caches
        // (tiles-v1/tiles-v2) are deliberately purged — tile requests now
        // bypass the SW entirely, so the cache no longer needs to exist.
        if (key !== APP_CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })()
  );
});

sw.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Deliberately do NOT intercept cross-origin map-tile requests. MapLibre
  // loads tiles with `crossOrigin='anonymous'`, and re-issuing that through
  // the SW's `fetch()` in Firefox surfaces as a CORS failure even when the
  // upstream sends valid CORS headers — opaque-response handling inside the
  // SW doesn't round-trip for WebGL textures. The browser handles tile
  // loads correctly when the SW stays out of the way. We rely on the HTTP
  // cache for repeat requests and revisit offline tile caching via a
  // separate, opt-in "Kartenausschnitt offline speichern" flow later.

  // App shell — cache-first for build/static assets.
  if (APP_ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) => cache.match(req).then((r) => r ?? fetch(req)))
    );
  }
});
