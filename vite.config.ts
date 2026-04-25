import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 3000
  },
  // `bun:sqlite` only exists when SSR runs under Bun (which it does for
  // `bun run dev` / the production adapter). Tell Vite to leave it alone so it
  // is resolved at runtime by Bun instead of being statically bundled.
  ssr: {
    external: ['bun:sqlite', 'better-sqlite3'],
    noExternal: []
  },
  optimizeDeps: {
    exclude: ['bun:sqlite', 'better-sqlite3']
  }
});
