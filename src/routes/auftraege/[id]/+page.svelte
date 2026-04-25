<script lang="ts">
  import type { PageData } from './$types';
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import {
    PRIORITIES,
    PRIORITY_LABELS,
    WORK_ORDER_STATUS_LABELS,
    type Priority,
    type WorkOrderStatus
  } from '$lib/enums';
  import { ArrowLeft, Copy, Link as LinkIcon, Check, CaretDown, WhatsappLogo, Clock, Prohibit, Tree } from 'phosphor-svelte';
  import { patchWorkOrder } from '../../work-orders.remote';
  import ContractorTaskMap from '$lib/components/ContractorTaskMap.svelte';

  let { data }: { data: PageData } = $props();

  let copied = $state(false);
  let auftragMapRef = $state<{ fitForestView: () => void } | null>(null);

  const taskMapTrees = $derived(
    data.trees.map((t) => ({
      id: t.treeId,
      latitude: Number(t.latitude),
      longitude: Number(t.longitude),
      healthStatus: t.healthStatus,
      status: t.status
    }))
  );

  async function copyLink() {
    await navigator.clipboard.writeText(data.shareUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  async function setPriority(p: Priority | null) {
    await patchWorkOrder({ id: data.order.id, userPriority: p });
    await invalidateAll();
  }

  async function extend(days: number | null) {
    await patchWorkOrder({ id: data.order.id, extendExpiryDays: days });
    await invalidateAll();
  }

  async function revoke() {
    if (!confirm('Link wirklich widerrufen?')) return;
    await patchWorkOrder({ id: data.order.id, revokeLink: true });
    await invalidateAll();
  }

  onMount(() => {
    const es = new EventSource(`/api/sse/work-order/${data.order.id}`);
    es.addEventListener('update', () => invalidateAll());
    return () => es.close();
  });

  const expiresIn = $derived.by(() => {
    if (!data.order.shareExpiresAt) return 'Nie';
    const ms = new Date(data.order.shareExpiresAt).getTime() - Date.now();
    if (ms < 0) return 'Abgelaufen';
    return `${Math.ceil(ms / (1000 * 60 * 60 * 24))} Tagen`;
  });

  const progress = $derived(
    data.counts.total === 0
      ? 0
      : Math.round(((data.counts.completed + data.counts.problem + data.counts.notFound) / data.counts.total) * 100)
  );

  const priorityClass = {
    low: 'priority-chip--low',
    normal: 'priority-chip--normal',
    high: 'priority-chip--high',
    urgent: 'priority-chip--urgent'
  } as const;
</script>

<div class="min-h-dvh bg-earth pb-14">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href="/auftraege"
        aria-label="Zurück"
        class="w-[38px] h-[38px] min-h-0 min-w-0 grid place-items-center rounded-btn border bg-surface text-ink hover:border-pine transition"
      >
        <ArrowLeft size="1.125em" weight="bold" />
      </a>
      <div class="flex-1 flex flex-col gap-[2px] min-w-0">
        <span class="eyebrow">Auftrag · {WORK_ORDER_STATUS_LABELS[data.order.status as WorkOrderStatus]}</span>
        <h1
          class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0 truncate"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          {data.order.title}
        </h1>
      </div>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    <!-- Progress hero -->
    <section class="relative overflow-hidden paper-elevated px-5 pt-6 pb-5 grid gap-4">
      <div
        class="absolute top-0 left-0 right-0 h-[3px]"
        style="background: linear-gradient(90deg, var(--color-moss), var(--color-leaf));"
        aria-hidden="true"
      ></div>

      <div class="flex flex-col gap-2">
        <span class="eyebrow">Fortschritt</span>
        <div class="flex items-baseline gap-2">
          <span class="numeral text-[4rem] leading-[0.9] text-ink">{progress}</span>
          <span class="font-serif italic text-[1.5rem] text-ember">%</span>
        </div>
        <div class="grid grid-cols-4 gap-3 pt-2 border-t border-hairline">
          <div class="flex flex-col gap-[2px]">
            <span class="numeral text-xl text-ink">{data.counts.completed}</span>
            <span class="text-[0.6875rem] tracking-caps uppercase text-content-muted">erledigt</span>
          </div>
          <div class="flex flex-col gap-[2px]">
            <span class="numeral text-xl text-ink">{data.counts.problem}</span>
            <span class="text-[0.6875rem] tracking-caps uppercase text-content-muted">Probleme</span>
          </div>
          <div class="flex flex-col gap-[2px]">
            <span class="numeral text-xl text-ink">{data.counts.notFound}</span>
            <span class="text-[0.6875rem] tracking-caps uppercase text-content-muted">n. gefunden</span>
          </div>
          <div class="flex flex-col gap-[2px]">
            <span class="numeral text-xl text-ink">{data.counts.total}</span>
            <span class="text-[0.6875rem] tracking-caps uppercase text-content-muted">gesamt</span>
          </div>
        </div>
      </div>

      <progress class="progress w-full" value={progress} max="100"></progress>

      <div class="flex justify-end">
        <div class="dropdown dropdown-end">
          <button
            tabindex="0"
            class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-earth border text-ink text-[0.8125rem] cursor-pointer"
          >
            <span class="eyebrow">Priorität</span>
            <span class="priority-chip {priorityClass[data.order.effectivePriority]}">
              {PRIORITY_LABELS[data.order.effectivePriority]}
            </span>
            <span class="text-[0.6875rem] text-content-muted tracking-caps uppercase font-semibold">
              {data.order.userPriority ? 'Manuell' : 'Auto'}
            </span>
            <CaretDown size="0.875em" />
          </button>
          <ul
            tabindex="0"
            class="dropdown-content menu bg-surface border rounded-box p-2 min-w-[220px] shadow-canopy z-30"
          >
            {#each PRIORITIES as p}
              <li>
                <button
                  class="block w-full text-left px-3 py-2 rounded-btn text-sm text-content hover:bg-surface-muted hover:text-ink"
                  onclick={() => setPriority(p)}
                >
                  {PRIORITY_LABELS[p]}
                </button>
              </li>
            {/each}
            <li><hr class="border-0 h-px bg-hairline my-1" /></li>
            <li>
              <button
                class="block w-full text-left px-3 py-2 rounded-btn text-sm text-content hover:bg-surface-muted hover:text-ink"
                onclick={() => setPriority(null)}
              >
                Auto verwenden
              </button>
            </li>
          </ul>
        </div>
      </div>
    </section>

    {#if data.order.instructions}
      <section class="paper px-5 py-5 flex flex-col gap-3">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="01"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Anweisungen
        </h2>
        <p class="text-[0.9375rem] leading-relaxed text-content whitespace-pre-wrap">{data.order.instructions}</p>
      </section>
    {/if}

    {#if data.order.workerNotes}
      <section class="paper px-5 py-5 flex flex-col gap-3">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="02"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Notizen des Forstunternehmens
        </h2>
        <p
          class="font-serif italic text-base text-content pl-3 border-l-2 whitespace-pre-wrap"
          style="border-color: var(--color-ember);"
        >
          {data.order.workerNotes}
        </p>
      </section>
    {/if}

    <!-- Share -->
    <section class="paper px-5 py-5 flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-3 flex-wrap">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="03"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Link teilen
        </h2>
        <span class="inline-flex items-center gap-1 text-xs text-content-muted font-semibold tracking-wide">
          <Clock size="0.875em" weight="bold" /> Läuft in {expiresIn} ab
        </span>
      </div>

      <div class="flex flex-wrap items-stretch gap-2">
        <div
          class="flex-1 min-w-0 inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-btn border border-dashed bg-earth text-content text-xs font-mono"
        >
          <LinkIcon size="0.875em" weight="bold" />
          <span class="truncate">{data.shareUrl}</span>
        </div>
        <button
          class="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-btn text-earth border font-semibold text-sm focus-ring"
          style="background: var(--color-pine); border-color: var(--color-pine-deep);"
          onclick={copyLink}
        >
          {#if copied}<Check size="1em" weight="bold" /> Kopiert{:else}<Copy size="1em" /> Kopieren{/if}
        </button>
      </div>

      <div class="flex flex-wrap gap-2">
        <a
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-content text-[0.8125rem] no-underline hover:border-pine hover:text-ink"
          target="_blank"
          rel="noopener"
          href="https://wa.me/?text={encodeURIComponent(data.order.title + ' — ' + data.shareUrl)}"
        >
          <WhatsappLogo size="1em" weight="fill" /> Per WhatsApp
        </a>
        <button
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-content text-[0.8125rem] hover:border-pine hover:text-ink"
          onclick={() => extend(30)}
        >
          <Clock size="1em" /> +30 Tage
        </button>
        <button
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-content text-[0.8125rem] hover:border-pine hover:text-ink"
          onclick={() => extend(null)}
        >
          Nie ablaufen
        </button>
        <button
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-crimson text-[0.8125rem] hover:border-crimson"
          style="--hover-bg: color-mix(in srgb, var(--color-crimson) 8%, transparent);"
          onclick={revoke}
        >
          <Prohibit size="1em" /> Widerrufen
        </button>
      </div>
    </section>

    {#if data.trees.length > 0}
      <section class="paper px-5 py-5 flex flex-col gap-3">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="04"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Karte
        </h2>
        <ContractorTaskMap
          bind:this={auftragMapRef}
          routes={data.routes}
          trees={taskMapTrees}
          areas={[]}
          forestParcels={data.plotParcels}
          forestCenter={data.plotCenter}
        />
        <button
          type="button"
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn border border-hairline bg-earth text-content font-semibold text-sm transition hover:border-pine self-start"
          onclick={() => auftragMapRef?.fitForestView()}
        >
          <Tree size="1.125em" weight="bold" />
          Zum Waldstück
        </button>
      </section>
    {/if}

    <!-- Trees -->
    <section class="paper px-5 py-5 flex flex-col gap-3">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="05"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Bäume im Auftrag
      </h2>
      <ul class="list-none p-0 m-0 flex flex-col">
        {#each data.trees as t}
          <li class="flex items-center justify-between gap-3 py-3 border-b border-hairline last:border-0">
            <span class="font-mono text-[0.8125rem] text-content">{t.treeId.slice(0, 8)}</span>
            <span class="chip-ghost">{t.status}</span>
          </li>
        {/each}
      </ul>
    </section>
  </main>
</div>
