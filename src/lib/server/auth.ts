// Better-auth setup: email + password only, no email verification, no password
// reset (README §5.1). Lazy-initialised so SvelteKit's prerender / analysis
// step doesn't explode when env vars are absent.

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { env } from '$env/dynamic/private';
import { db } from './db';
import * as schema from './db/schema';

let _auth: ReturnType<typeof betterAuth> | null = null;

function init() {
  const secret = env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set');

  const baseURL = env.BETTER_AUTH_URL ?? env.ORIGIN ?? 'http://localhost:3000';

  // Better-auth rejects any POST whose Origin header is not in trustedOrigins
  // (defaults to just `baseURL`). On the VPS this fails the moment the request
  // arrives via www., a different scheme, or the operator forgot to set
  // BETTER_AUTH_URL to the exact public origin. Include everything we can
  // plausibly trust and the common dev URLs.
  const domain = env.DOMAIN;
  const trustedOrigins = Array.from(
    new Set(
      [
        baseURL,
        env.ORIGIN,
        domain && `https://${domain}`,
        domain && `https://www.${domain}`,
        'http://localhost:3000',
        'http://localhost:5173'
      ].filter((v): v is string => Boolean(v))
    )
  );

  const opts: BetterAuthOptions = {
    secret,
    baseURL,
    trustedOrigins,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications
      }
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 8
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24
    }
  };

  _auth = betterAuth(opts);
  return _auth;
}

export const auth = new Proxy({} as ReturnType<typeof betterAuth>, {
  get(_t, prop: string) {
    const a = _auth ?? init();
    const v = (a as any)[prop];
    return typeof v === 'function' ? v.bind(a) : v;
  }
});

export type Auth = ReturnType<typeof betterAuth>;
