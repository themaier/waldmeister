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

  const opts: BetterAuthOptions = {
    secret,
    baseURL: env.BETTER_AUTH_URL ?? 'http://localhost:3000',
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
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production',
      crossSubDomainCookies: { enabled: false }
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
