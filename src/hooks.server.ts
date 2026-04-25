import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { ensureDefaultPlotForUser } from '$lib/server/default-plot';
// Side-effect import: registers every SSE topic exactly once at server boot.
import '$lib/server/sse-topics';

// Expose `event.locals.user` + `event.locals.session` on every request, and
// forward every request that starts with /api/auth/* to better-auth's handler.
// We route by pathname only — better-auth's bundled svelteKitHandler also
// matches on `url.origin === baseURL.origin`, which silently no-ops auth
// routes whenever the public host (or the dev port) differs from
// BETTER_AUTH_URL. trustedOrigins in auth.ts handles the Origin/CSRF check.

export const handle: Handle = async ({ event, resolve }) => {
  if (building) return resolve(event);

  if (event.url.pathname.startsWith('/api/auth')) {
    return auth.handler(event.request);
  }

  const session = await auth.api.getSession({ headers: event.request.headers });
  if (session) {
    event.locals.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name
    };
    event.locals.session = {
      id: session.session.id,
      expiresAt: new Date(session.session.expiresAt)
    };
    await ensureDefaultPlotForUser(session.user.id);
  } else {
    event.locals.user = null;
    event.locals.session = null;
  }

  return resolve(event);
};
