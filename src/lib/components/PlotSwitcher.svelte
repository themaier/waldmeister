<script lang="ts">
  // Top bar: a compact SaaS-style masthead. A serifed plot name anchors the
  // center, flanked by prev/next chevrons. On the right sits the create
  // action and the user menu. See §5.2.
  import { CaretLeft, CaretRight, Plus, SignOut, ListChecks, Tree } from 'phosphor-svelte';
  import { authClient } from '$lib/auth-client';
  import { goto } from '$app/navigation';

  interface Plot {
    id: string;
    name: string | null;
  }
  interface Props {
    plots: Plot[];
    activeId: string | null;
    onSwitch: (id: string) => void;
    onCreate: () => void;
    toolActive?: boolean;
    userName?: string;
  }

  let { plots, activeId, onSwitch, onCreate, toolActive = false, userName = '' }: Props = $props();

  const activeIndex = $derived(plots.findIndex((p) => p.id === activeId));
  const hasMultiple = $derived(plots.length > 1);
  const activeName = $derived(
    plots[activeIndex]?.name ?? (activeIndex >= 0 ? `Waldstück ${activeIndex + 1}` : 'Kein Waldstück')
  );
  const indexLabel = $derived(
    plots.length > 0 && activeIndex >= 0
      ? `${String(activeIndex + 1).padStart(2, '0')} / ${String(plots.length).padStart(2, '0')}`
      : '—'
  );

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

  const initial = $derived((userName || '').trim().slice(0, 1).toUpperCase() || 'W');
</script>

<header
  class="relative z-20 bg-surface/85 border-b backdrop-blur-md backdrop-saturate-150"
>
  <div class="flex items-center gap-3 px-4 py-2">
    <!-- Brand mark -->
    <a href="/" aria-label="Waldmeister" class="inline-flex items-center gap-2 text-ink no-underline">
      <span
        class="grid place-items-center w-9 h-9 rounded-btn text-earth shadow-duff"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep));"
        aria-hidden="true"
      >
        <Tree size="1.125em" weight="fill" />
      </span>
      <span class="hidden sm:inline font-serif font-semibold text-[1.0625rem] tracking-tight">
        Waldmeister
      </span>
    </a>

    <span class="self-stretch w-px bg-hairline min-h-[28px]" aria-hidden="true"></span>

    <!-- Plot navigator -->
    <div class="flex-1 grid grid-cols-[auto_1fr_auto] items-center gap-2 min-w-0">
      <button
        class="w-9 h-9 grid place-items-center rounded-btn text-content-muted hover:text-ink hover:bg-surface-muted hover:border-hairline border border-transparent transition disabled:opacity-35 disabled:cursor-not-allowed min-h-0"
        onclick={prev}
        disabled={!hasMultiple}
        aria-label="Vorheriges Waldstück"
      >
        <CaretLeft size="1.125em" weight="bold" />
      </button>

      <div class="text-center min-w-0 flex flex-col items-center gap-[2px]">
        <span class="eyebrow">Waldstück · {indexLabel}</span>
        <h1
          class="font-serif font-medium text-[1.0625rem] leading-tight tracking-tight text-ink truncate max-w-[42vw]"
          title={activeName}
        >
          {activeName}
        </h1>
        {#if toolActive}
          <span class="inline-flex items-center gap-2 text-[0.6875rem] text-rust font-semibold tracking-wide">
            <span class="w-1.5 h-1.5 rounded-full bg-rust animate-breathe"></span>
            Werkzeug aktiv
          </span>
        {/if}
      </div>

      <button
        class="w-9 h-9 grid place-items-center rounded-btn text-content-muted hover:text-ink hover:bg-surface-muted hover:border-hairline border border-transparent transition disabled:opacity-35 disabled:cursor-not-allowed min-h-0"
        onclick={next}
        disabled={!hasMultiple}
        aria-label="Nächstes Waldstück"
      >
        <CaretRight size="1.125em" weight="bold" />
      </button>
    </div>

    <span class="self-stretch w-px bg-hairline min-h-[28px]" aria-hidden="true"></span>

    <!-- Actions -->
    <div class="flex items-center gap-2">
      <button
        class="w-[38px] h-[38px] grid place-items-center rounded-btn text-earth border shadow-duff transition hover:-translate-y-px hover:shadow-understory min-h-0"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        onclick={onCreate}
        aria-label="Neues Waldstück"
      >
        <Plus size="1.125em" weight="bold" />
      </button>

      <div class="dropdown dropdown-end">
        <button
          tabindex="0"
          class="relative w-[38px] h-[38px] min-h-0 rounded-full bg-surface border text-ink font-serif font-semibold text-[0.9375rem] grid place-items-center hover:border-pine transition"
          aria-label="Benutzermenü"
        >
          <span class="absolute -inset-[3px] rounded-full border border-hairline pointer-events-none"></span>
          <span>{initial}</span>
        </button>
        <ul
          role="menu"
          tabindex="0"
          class="dropdown-content menu mt-2 p-2 min-w-[220px] rounded-box bg-surface border shadow-canopy z-30"
        >
          <li class="px-3 pt-2 pb-3 flex flex-col gap-[2px] border-b border-hairline mb-2">
            <span class="eyebrow">Angemeldet</span>
            <span class="font-serif font-medium text-[0.9375rem] text-ink">{userName || 'Konto'}</span>
          </li>
          <li>
            <a href="/auftraege" class="flex items-center gap-2 text-sm text-content hover:bg-surface-muted hover:text-ink">
              <ListChecks size="1.1em" /> Aufträge
            </a>
          </li>
          <li>
            <button onclick={logout} class="flex items-center gap-2 text-sm text-content hover:bg-surface-muted hover:text-crimson w-full">
              <SignOut size="1.1em" /> Abmelden
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</header>
