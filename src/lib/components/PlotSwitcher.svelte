<script lang="ts">
  // Top bar — mobile-first masthead.
  //
  // Layout in a single compact row:
  //   [‹] [Plot name + index chip] [›] | [+]   [User]
  //
  // The Plus button is a dropdown with three creation shortcuts
  // (Waldstück / Baum / Auftrag). The avatar dropdown holds account-only
  // actions (Abmelden). All leading icon buttons are 44×44 to match the
  // app-wide touch-target rule.
  import {
    CaretLeft,
    CaretRight,
    Plus,
    SignOut,
    Tree,
    Crosshair,
    ClipboardText
  } from 'phosphor-svelte';
  import { authClient } from '$lib/auth-client';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  interface Plot {
    id: string;
    name: string | null;
  }
  interface Props {
    plots: Plot[];
    activeId: string | null;
    onSwitch: (id: string) => void;
    toolActive?: boolean;
    userName?: string;
  }

  let { plots, activeId, onSwitch, toolActive = false, userName = '' }: Props =
    $props();

  const activeIndex = $derived(plots.findIndex((p) => p.id === activeId));
  const hasMultiple = $derived(plots.length > 1);
  const activeName = $derived(
    plots[activeIndex]?.name ??
      (activeIndex >= 0 ? `Waldstück ${activeIndex + 1}` : 'Kein Waldstück')
  );
  const indexLabel = $derived(
    plots.length > 0 && activeIndex >= 0
      ? `${activeIndex + 1}/${plots.length}`
      : ''
  );
  // Baum creation needs a plot context — disable when there isn't one.
  const baumHref = $derived(activeId ? `/baeume/neu?plot=${activeId}` : null);
  const initial = $derived(
    (userName || '').trim().slice(0, 1).toUpperCase() || 'W'
  );
  const fromHref = $derived.by(() => `${page.url.pathname}${page.url.search}`);

  function prev() {
    if (!hasMultiple) return;
    const idx = (activeIndex - 1 + plots.length) % plots.length;
    onSwitch(plots[idx].id);
  }
  function next() {
    if (!hasMultiple) return;
    const idx = (activeIndex + 1) % plots.length;
    onSwitch(plots[idx].id);
  }
  async function logout() {
    await authClient.signOut();
    await goto('/login');
  }
</script>

<header
  class="sticky top-0 z-20 bg-surface/85 border-b backdrop-blur-md backdrop-saturate-150"
  style="padding-top: env(safe-area-inset-top);"
>
  <div class="flex items-center gap-1 px-2 sm:px-3 py-2">
    <!-- Plot navigator -->
    <button
      class="w-11 h-11 grid place-items-center rounded-btn text-content-muted hover:text-ink hover:bg-surface-muted border border-transparent transition disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
      onclick={prev}
      disabled={!hasMultiple}
      aria-label="Vorheriges Waldstück"
    >
      <CaretLeft size="1.125em" weight="bold" />
    </button>

    <div
      class="flex-1 min-w-0 flex flex-col items-start sm:items-center gap-0"
    >
      <div class="flex items-center gap-1.5 min-w-0 max-w-full">
        <h1
          class="font-serif font-medium text-[1.0625rem] leading-tight tracking-tight text-ink truncate"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
          title={activeName}
        >
          {activeName}
        </h1>
        {#if indexLabel}
          <span
            class="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-pill text-[0.6875rem] font-semibold tracking-tight bg-surface-muted text-content-muted border"
            aria-label="Waldstück {indexLabel}"
          >
            {indexLabel}
          </span>
        {/if}
      </div>
      {#if toolActive}
        <span
          class="inline-flex items-center gap-1.5 text-[0.6875rem] text-rust font-semibold tracking-wide leading-none mt-0.5"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-rust animate-breathe"></span>
          Werkzeug aktiv
        </span>
      {/if}
    </div>

    <button
      class="w-11 h-11 grid place-items-center rounded-btn text-content-muted hover:text-ink hover:bg-surface-muted border border-transparent transition disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
      onclick={next}
      disabled={!hasMultiple}
      aria-label="Nächstes Waldstück"
    >
      <CaretRight size="1.125em" weight="bold" />
    </button>

    <span
      class="self-stretch w-px bg-hairline mx-1 sm:mx-1.5 my-1"
      aria-hidden="true"
    ></span>

    <!-- Create-new dropdown — three creation shortcuts behind one Plus. -->
    <div class="dropdown dropdown-end flex-shrink-0">
      <button
        tabindex="0"
        class="w-11 h-11 grid place-items-center rounded-btn text-earth border shadow-duff transition hover:-translate-y-px hover:shadow-understory flex-shrink-0 p-0"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        aria-label="Neu erstellen"
      >
        <Plus size="1.25em" weight="bold" />
      </button>
      <ul
        role="menu"
        tabindex="0"
        class="dropdown-content mt-2 p-2 min-w-[264px] rounded-box bg-surface border shadow-canopy z-30 flex flex-col gap-1 list-none"
      >
        <li>
          <a
            href="/waldstuecke/neu"
            role="menuitem"
            class="plus-item flex items-center gap-3 px-2 py-2.5 rounded-btn no-underline transition"
          >
            <span class="plus-item-tile">
              <Tree size="1.35em" weight="regular" />
            </span>
            <span class="text-[0.9375rem] font-semibold text-ink leading-tight"
              >Neues Waldstück</span
            >
          </a>
        </li>
        <li>
          {#if baumHref}
            <a
              href={baumHref}
              role="menuitem"
              class="plus-item flex items-center gap-3 px-2 py-2.5 rounded-btn no-underline transition"
            >
              <span class="plus-item-tile">
                <Crosshair size="1.35em" weight="regular" />
              </span>
              <span
                class="text-[0.9375rem] font-semibold text-ink leading-tight"
                >Neuer Baum</span
              >
            </a>
          {:else}
            <span
              class="plus-item plus-item-disabled flex items-center gap-3 px-2 py-2.5 rounded-btn"
              aria-disabled="true"
              title="Zuerst ein Waldstück auswählen"
            >
              <span class="plus-item-tile">
                <Crosshair size="1.35em" weight="regular" />
              </span>
              <span
                class="text-[0.9375rem] font-semibold text-content-muted leading-tight"
                >Neuer Baum</span
              >
            </span>
          {/if}
        </li>
        <li>
          <a
            href={`/auftraege/neu?from=${encodeURIComponent(fromHref)}`}
            role="menuitem"
            class="plus-item flex items-center gap-3 px-2 py-2.5 rounded-btn no-underline transition"
          >
            <span class="plus-item-tile">
              <ClipboardText size="1.35em" weight="regular" />
            </span>
            <span class="text-[0.9375rem] font-semibold text-ink leading-tight"
              >Neuer Auftrag</span
            >
          </a>
        </li>
      </ul>
    </div>

    <!-- Avatar — small extra breathing room away from the Plus. -->
    <div class="dropdown dropdown-end flex-shrink-0 ml-2">
      <button
        tabindex="0"
        class="w-11 h-11 rounded-full bg-surface border text-ink font-serif font-semibold text-[0.9375rem] grid place-items-center hover:border-pine transition"
        style="font-variation-settings: 'opsz' 48, 'SOFT' 40, 'WONK' 1;"
        aria-label="Konto"
      >
        <span>{initial}</span>
      </button>
      <ul
        role="menu"
        tabindex="0"
        class="dropdown-content menu mt-2 p-2 min-w-[220px] rounded-box bg-surface border shadow-canopy z-30"
      >
        <li
          class="px-3 pt-2 pb-3 flex flex-col gap-[2px] border-b border-hairline mb-2"
        >
          <span class="eyebrow">Angemeldet</span>
          <span
            class="font-serif font-medium text-[0.9375rem] text-ink truncate"
            >{userName || 'Konto'}</span
          >
        </li>
        <li>
          <a
            href="/auftraege"
            class="flex items-center gap-2 text-sm text-content hover:bg-surface-muted hover:text-ink w-full"
          >
            <ClipboardText size="1.1em" /> Aufträge
          </a>
        </li>
        <li>
          <button
            onclick={logout}
            class="flex items-center gap-2 text-sm text-content hover:bg-surface-muted hover:text-crimson w-full"
          >
            <SignOut size="1.1em" /> Abmelden
          </button>
        </li>
      </ul>
    </div>
  </div>
</header>

<style>
  /* Creation-shortcut rows — tile + label + generous touch target. */
  .plus-item {
    cursor: pointer;
  }
  .plus-item-tile {
    display: grid;
    place-items: center;
    width: 2.5rem;
    height: 2.5rem;
    flex-shrink: 0;
    border-radius: var(--radius-btn);
    background: var(--color-surface-muted);
    border: 1px solid var(--color-hairline);
    color: var(--color-pine-deep);
    transition:
      background-color 160ms var(--ease-forest),
      border-color 160ms var(--ease-forest),
      color 160ms var(--ease-forest);
  }
  .plus-item:hover {
    background: var(--color-surface-muted);
  }
  .plus-item:hover .plus-item-tile {
    background: color-mix(in srgb, var(--color-pine) 14%, var(--color-surface));
    border-color: color-mix(in srgb, var(--color-pine) 45%, transparent);
    color: var(--color-pine-deep);
  }
  .plus-item:active {
    transform: translateY(1px);
  }
  .plus-item-disabled {
    opacity: 0.45;
    cursor: not-allowed;
    pointer-events: none;
  }
</style>
