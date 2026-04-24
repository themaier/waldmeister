# CLAUDE.md

Notes for working in this repo. Short, opinionated, current.

## Stack
- **SvelteKit 2 + Svelte 5 (runes)**
- TypeScript, Tailwind, Drizzle, MapLibre GL
- Postgres + S3-compatible storage (see `DEV.md` / `DEPLOYMENT.md`)

## Svelte 5 runes — what tripped me up

### `$state` vs `$derived` — choose deliberately

- `$state(x)` creates a **mutable cell initialised once** with `x`. It does **not** track `x`. If `x` was a prop or another reactive value, later changes to `x` are ignored.
- `$derived(expr)` recomputes whenever reactive reads inside `expr` change. Declared variables are read-only.
- `$derived.by(() => { ...; return v })` is the function form — use it for multi-statement derivations. Evaluates the body and stores the returned value; you consume it as `name` (no call).

**Default to `$derived` when a value is a function of props/other reactive state.** Only reach for `$state(fromProp)` when you truly want a local copy that intentionally ignores prop updates — form fields with `bind:value` are the canonical case.

```svelte
<!-- BAD: stale if data.plots changes -->
let activePlotId = $state<string | null>(data.plots[0]?.id ?? null);

<!-- GOOD: derive-with-override. manual selection wins if still valid; else fall back to data. -->
let manualPlotId = $state<string | null>(null);
const activePlotId = $derived(
  manualPlotId && data.plots.some((p) => p.id === manualPlotId)
    ? manualPlotId
    : data.plots[0]?.id ?? null
);
```

If you genuinely want a one-shot snapshot of a reactive value (no re-derivation), wrap the initial read in `untrack(() => …)` from `svelte` to make the intent explicit:

```ts
import { untrack } from 'svelte';
let draft = $state(untrack(() => data.initial.text)); // edited locally, never resyncs
```

### Load-data passed through `$derived` is not deeply reactive

`data` from a SvelteKit `+page.(server.)ts` load is plain JSON — SvelteKit makes the top-level `data` prop reactive, but objects and arrays inside it are **not** `$state` proxies. A value like `$derived(data.tree)` re-runs when `data` itself is replaced, but mutating a nested field on the returned object does **not** propagate.

If you need deep reactivity (e.g., locally editable copy of a nested record), wrap the value in `$state` from inside a `$derived.by`, so SvelteKit's data updates produce a fresh reactive proxy:

```ts
// Deeply reactive local copy, re-created whenever load data changes.
const tree = $derived.by(() => {
  const local = $state({ ...data.tree });
  return local;
});
// Now `tree.name = 'X'` triggers updates, and re-loading page data yields a fresh copy.
```

If you just read (no nested mutation), plain `$derived(data.something)` is fine.

### `Map`/`Set` are not reactive in `$state`

Svelte's `$state` proxy wraps plain objects and arrays but **not** `Map` or `Set`. `$state(new Map())` / `$state(new Set())` appears to work but mutations (`.set`, `.add`, `.delete`) won't trigger updates.

Options:
- **`SvelteMap` / `SvelteSet`** from `svelte/reactivity` — reactive drop-ins with the same API.
- **`$state<Record<string, T>>({})`** — use a plain object keyed by id when you just need membership/lookup. Preferred in this repo.

```ts
// ❌ Silent breakage
let selected = $state(new Set<string>());
selected.add(id); // UI doesn't update

// ✅ Record
let selected = $state<Record<string, true>>({});
selected[id] = true;

// ✅ SvelteSet when you really need Set semantics (iteration order, size, etc.)
import { SvelteSet } from 'svelte/reactivity';
let selected = new SvelteSet<string>();
```

Inside `$derived`, a freshly-built `new Set(...)` is fine — it's rebuilt wholesale on each dep change — but for consistency and to keep callers drop-in with `$state`, we prefer `Record` here too.

### `$derived` pitfalls

- `$derived(() => x)` stores the **function**, not `x`. You almost always want `$derived(x)` or `$derived.by(() => x)`. Giveaway: you end up calling `foo()` in the template.
- The expression must be side-effect free; Svelte forbids state mutation inside it.
- Destructuring works: `const { a, b } = $derived(stuff())` — each binding becomes its own derived.

### `bind:this` needs `$state`

For a `bind:this={ref}` to trigger `$effect` re-runs once the node/component mounts, `ref` must be declared with `$state`:

```ts
let mapRef = $state<Map | undefined>();   // ✅ effect re-runs after mount
// let mapRef: Map;                        // ❌ plain let — effect sees undefined forever
$effect(() => {
  if (!mapRef) return;
  // ...
});
```

### `$props`

- `let { foo, bar = 1 }: Props = $props();` — destructure with defaults.
- Props are reactive. Treat them like `$derived`: read, don't reassign. Pass through `$derived` or `$state(untrack(...))` if you need a local copy.

### `$effect`

- Auto-tracks reactive reads during the synchronous body. Async reads after an `await` are **not** tracked (except `await` in `$derived` expression itself — different rule).
- Avoid writing state inside effects where a `$derived` would do. Cycles are easy.
- Return a teardown function from `$effect(() => { ... return () => cleanup(); })` — replaces most `onDestroy` uses.

### SvelteKit route state

- Prefer `$app/state` (Svelte 5 / SvelteKit ≥2.12) over deprecated `$app/stores`. `page.params`, `page.url`, etc. are reactive objects — read them inside `$derived`/templates, no `$`-prefix.

```ts
import { page } from '$app/state';
const id = $derived(page.params.id);
```

## Conventions in this repo

- German UI copy, English identifiers (`waldstuecke/`, `auftraege/`, `baeume/` URLs).
- Remote functions live in `*.remote.ts` alongside the routes that use them.
- One persistent `MapLibre` instance in `src/lib/components/Map.svelte`, driven imperatively via `bind:this` + exposed methods (`instance()`, `flyTo`, `fitBounds`).
- Enums/labels centralised in `src/lib/enums.ts`.
