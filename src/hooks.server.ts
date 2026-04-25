import { redirect, type Handle } from '@sveltejs/kit';
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

  const path = event.url.pathname;
  // `/_app/*` covers SvelteKit internals: client JS chunks, the data-loading
  // protocol, and remote functions. Never redirect these — remote functions
  // enforce their own auth (`error(401)`) and a 303 here gets translated into
  // a JSON redirect that the remote-function client surfaces as "Failed to
  // execute remote function" / "Redirects are not allowed in commands". This
  // bites mobile harder because Safari is stricter about cookies, so a single
  // missing session cookie cascades into every remote call failing.
  const isPublic =
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/api/auth') ||
    path.startsWith('/a/') ||
    path.startsWith('/_app/');
  if (!event.locals.user && !isPublic) {
    throw redirect(303, '/login');
  }

  return resolve(event);
};
