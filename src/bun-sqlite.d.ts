// Minimal ambient declaration so that TypeScript stops complaining about the
// `bun:sqlite` import. The actual module is provided at runtime by Bun and is
// only loaded behind a `typeof Bun !== 'undefined'` check, so types here just
// need to satisfy the compiler — see `src/lib/server/sqlite-driver.ts`.
declare module 'bun:sqlite' {
  type Statement = {
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
  export class Database {
    constructor(filename: string, options?: { readonly?: boolean; create?: boolean });
    prepare(sql: string): Statement;
    close(): void;
  }
}
