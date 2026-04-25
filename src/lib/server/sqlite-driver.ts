// Tiny wrapper that hides the difference between Bun's `bun:sqlite` and
// `better-sqlite3`. We need both because the SvelteKit dev server runs under
// Bun (where `better-sqlite3`'s native bindings refuse to load), while Node-
// based scripts (migrations, smoke tests) cannot import `bun:sqlite`.
//
// We deliberately avoid `await import('bun:sqlite')`: under Vite SSR that
// goes through Vite's resolver and fails *silently* (the import resolves to
// something with no `Database` export, or throws for reasons unrelated to
// runtime availability). `createRequire` bypasses Vite entirely and hands
// the resolution straight to the runtime (Bun or Node), so when we run as
// `bun run dev` the bun-builtin module is found and the better-sqlite3
// branch never fires.

import { createRequire } from 'node:module';

type Statement = {
  all: (...params: unknown[]) => unknown[];
  get: (...params: unknown[]) => unknown;
};

export type SqliteHandle = {
  prepare: (sql: string) => Statement;
  close: () => void;
};

type Opener = (path: string) => SqliteHandle;

const requireFn = createRequire(import.meta.url);

let cachedOpener: Opener | null = null;

function loadOpener(): Opener {
  if (cachedOpener) return cachedOpener;

  // Bun's built-in driver — works under `bun run dev` because Bun resolves
  // the `bun:` scheme to the in-process module. Throws under Node.
  try {
    const mod = requireFn('bun:sqlite') as {
      Database: new (path: string, options?: { readonly?: boolean }) => SqliteHandle;
    };
    if (typeof mod?.Database === 'function') {
      cachedOpener = (path) => new mod.Database(path, { readonly: true });
      return cachedOpener;
    }
  } catch {
    /* not running under Bun — fall through */
  }

  const mod = requireFn('better-sqlite3') as {
    default?: new (
      path: string,
      options?: { readonly?: boolean; fileMustExist?: boolean }
    ) => SqliteHandle;
    (
      path: string,
      options?: { readonly?: boolean; fileMustExist?: boolean }
    ): SqliteHandle;
  };
  // CommonJS export shape varies (default vs callable); handle both.
  const Ctor = mod.default ?? mod;
  cachedOpener = (path) =>
    new (Ctor as new (
      p: string,
      o?: { readonly?: boolean; fileMustExist?: boolean }
    ) => SqliteHandle)(path, { readonly: true, fileMustExist: true });
  return cachedOpener;
}

export async function openReadOnlySqlite(path: string): Promise<SqliteHandle> {
  return loadOpener()(path);
}
