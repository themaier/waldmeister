<script lang="ts">
  import type { PageData } from './$types';
  import {
    PRIORITY_LABELS,
    WORK_ORDER_STATUS_LABELS,
    type Priority,
    type WorkOrderStatus
  } from '$lib/enums';
  import { ArrowLeft, Plus, Tree, ArrowUpRight } from 'phosphor-svelte';

  let { data }: { data: PageData } = $props();

  const priorityClass: Record<Priority, string> = {
    low: 'priority-chip--low',
    normal: 'priority-chip--normal',
    high: 'priority-chip--high',
    urgent: 'priority-chip--urgent'
  };

  const totalTrees = $derived(data.orders.reduce((sum, o) => sum + (o.treeTotal ?? 0), 0));
  const openCount = $derived(
    data.orders.filter((o) => o.status !== 'COMPLETED' && o.status !== 'ARCHIVED').length
  );
</script>

<div class="min-h-dvh bg-earth pb-12">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-3xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href="/"
        aria-label="Zurück zur Karte"
        class="w-[38px] h-[38px] min-h-0 min-w-0 grid place-items-center rounded-btn border bg-surface text-ink hover:border-pine transition"
      >
        <ArrowLeft size="1.125em" weight="bold" />
      </a>
      <div class="flex-1 flex flex-col gap-[2px]">
        <span class="eyebrow">Übersicht</span>
        <h1
          class="font-serif font-medium text-[1.5rem] leading-none tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Aufträge
        </h1>
      </div>
      <a
        href="/auftraege/neu"
        class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm no-underline shadow-duff transition hover:-translate-y-px hover:shadow-understory"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
      >
        <Plus size="1.125em" weight="bold" />
        <span>Neuer Auftrag</span>
      </a>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-3xl mx-auto px-4 pt-5 flex flex-col gap-5">
    {#if data.orders.length === 0}
      <section class="grain relative bg-surface border rounded-box px-6 py-10 flex flex-col items-center text-center gap-3 shadow-duff">
        <span class="w-12 h-12 grid place-items-center rounded-btn text-pine border border-hairline mb-2" style="background: color-mix(in srgb, var(--color-pine) 8%, transparent);">
          <Tree size="1.5em" weight="duotone" />
        </span>
        <h2 class="font-serif font-normal text-2xl tracking-tight text-ink m-0">Noch keine Aufträge.</h2>
        <p class="text-content-muted max-w-[34rem] text-[0.9375rem] leading-relaxed">
          Erstelle deinen ersten Arbeitsauftrag, um Bäume mit einem Link an dein Forstunternehmen zu geben.
          Ablauf, Priorität und Umfang bestimmst du.
        </p>
        <a
          href="/auftraege/neu"
          class="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-btn text-earth border font-semibold text-sm no-underline mt-2"
          style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        >
          <Plus size="1.125em" weight="bold" /> Ersten Auftrag erstellen
        </a>
      </section>
    {:else}
      <section class="flex items-stretch gap-5 px-5 py-4 bg-surface border rounded-box shadow-duff">
        <div class="flex-1 flex flex-col gap-1">
          <span class="eyebrow">Aktiv</span>
          <span class="numeral text-[2rem] text-ink">{openCount}</span>
          <span class="text-xs text-content-muted">von {data.orders.length} Aufträgen</span>
        </div>
        <span class="w-px bg-hairline" aria-hidden="true"></span>
        <div class="flex-1 flex flex-col gap-1">
          <span class="eyebrow">Bäume im Auftrag</span>
          <span class="numeral text-[2rem] text-ink">{totalTrees}</span>
          <span class="text-xs text-content-muted">gesamt verteilt</span>
        </div>
      </section>

      <ul class="list-none p-0 m-0 flex flex-col gap-2">
        {#each data.orders as o, i}
          <li>
            <a
              href="/auftraege/{o.id}"
              class="group grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 bg-surface border rounded-box no-underline text-inherit shadow-duff transition hover:-translate-y-px hover:shadow-understory hover:border-pine/30"
            >
              <span
                class="numeral italic text-[1.5rem] text-ember self-start pt-[2px]"
                style="font-variation-settings: 'opsz' 144, 'SOFT' 80, 'WONK' 1;"
              >
                {String(i + 1).padStart(2, '0')}
              </span>

              <div class="flex flex-col gap-2 min-w-0">
                <div class="flex flex-wrap items-center gap-3 justify-between">
                  <h3
                    class="font-serif font-medium text-[1.0625rem] leading-snug tracking-tight text-ink m-0"
                    style="font-variation-settings: 'opsz' 96, 'SOFT' 30, 'WONK' 0;"
                  >
                    {o.title}
                  </h3>
                  <span class="priority-chip {priorityClass[o.effectivePriority]}">
                    {PRIORITY_LABELS[o.effectivePriority]}
                  </span>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-[0.8125rem] text-content-muted">
                  <span class="chip-ghost">{WORK_ORDER_STATUS_LABELS[o.status as WorkOrderStatus]}</span>
                  <span class="text-content-faint">·</span>
                  <span>{o.treeTotal} Bäume</span>
                  {#if o.userPriority}
                    <span class="text-content-faint">·</span>
                    <span class="text-xs text-bark font-semibold tracking-wide">Manuelle Priorität</span>
                  {/if}
                </div>
              </div>

              <span
                class="w-[34px] h-[34px] grid place-items-center rounded-btn text-content-muted border border-hairline bg-earth transition group-hover:text-pine group-hover:border-pine"
                style="background: var(--color-background);"
                aria-hidden="true"
              >
                <ArrowUpRight size="1em" weight="bold" />
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </main>
</div>
