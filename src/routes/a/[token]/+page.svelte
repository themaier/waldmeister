<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { CheckCircle, WarningCircle, Question, Tree, Path } from 'phosphor-svelte';
  import { HEALTH_LABELS, HEALTH_COLORS, TREE_LABEL_LABELS, type HealthStatus, type TreeLabel } from '$lib/enums';
  import { saveContractorNotes, updateContractorTreeStatus } from './contractor.remote';

  let { data }: { data: PageData } = $props();

  let orderNotes = $state('');
  let savingNotes = $state(false);

  const token = $derived(page.params.token);

  const progress = $derived.by(() => {
    const total = data.trees.length;
    if (total === 0) return 0;
    const done = data.trees.filter((t) => t.status !== 'OPEN').length;
    return Math.round((done / total) * 100);
  });

  async function markTree(
    assignmentId: string,
    status: 'COMPLETED' | 'PROBLEM' | 'NOT_FOUND',
    message: string | null = null
  ) {
    await updateContractorTreeStatus({ token, assignmentId, status, statusMessage: message });
    await invalidateAll();
  }

  async function saveNotes() {
    savingNotes = true;
    try {
      await saveContractorNotes({ token, notes: orderNotes });
    } finally {
      savingNotes = false;
    }
  }

  const healthPillClass: Record<HealthStatus, string> = {
    healthy: 'health-pill--healthy',
    'must-watch': 'health-pill--must-watch',
    infected: 'health-pill--infected',
    dead: 'health-pill--dead'
  };
</script>

<div class="min-h-dvh bg-earth pb-12">
  <!-- Dense work-focused hero -->
  <header
    class="relative overflow-hidden text-earth px-4 pt-6 pb-5"
    style="background: linear-gradient(180deg, var(--color-pine-deep) 0%, var(--color-pine) 100%);"
  >
    <div class="max-w-2xl mx-auto flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <span
          class="w-10 h-10 grid place-items-center rounded-btn text-leaf border"
          style="background: color-mix(in srgb, var(--color-leaf) 20%, transparent); border-color: color-mix(in srgb, var(--color-leaf) 35%, transparent);"
        >
          <Tree size="1.25em" weight="fill" />
        </span>
        <span
          class="eyebrow"
          style="color: color-mix(in srgb, var(--color-earth) 65%, transparent);"
        >
          Arbeitsauftrag
        </span>
      </div>

      <h1
        class="font-serif font-normal text-[clamp(1.75rem,5vw,2.5rem)] leading-[1.05] tracking-tight m-0 text-earth"
        style="font-variation-settings: 'opsz' 144, 'SOFT' 50, 'WONK' 1;"
      >
        {data.order.title}
      </h1>

      <div class="flex items-baseline gap-2">
        <span class="numeral text-[2.5rem] leading-none text-earth">{progress}</span>
        <span class="font-serif italic text-xl text-ember">%</span>
        <span
          class="text-xs font-semibold tracking-caps uppercase ml-1"
          style="color: color-mix(in srgb, var(--color-earth) 65%, transparent);"
        >
          abgeschlossen · {data.trees.length} Bäume
        </span>
      </div>

      <progress class="progress w-full" value={progress} max="100"></progress>
    </div>
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    {#if data.order.instructions}
      <section class="paper px-5 py-5 flex flex-col gap-2">
        <span class="eyebrow">Anweisungen</span>
        <p
          class="font-serif italic text-base text-content pl-3 border-l-2 whitespace-pre-wrap"
          style="border-color: var(--color-ember);"
        >
          {data.order.instructions}
        </p>
      </section>
    {/if}

    {#if data.routes.length > 0}
      <section class="paper px-5 py-5 flex flex-col gap-3">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="01"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Wege
        </h2>
        <ul class="list-none p-0 m-0 flex flex-col gap-3">
          {#each data.routes as r}
            <li class="flex items-start gap-3 pb-3 border-b border-hairline last:border-0 last:pb-0">
              <span
                class="mt-1 w-8 h-8 grid place-items-center rounded-btn text-pine border border-hairline"
                style="background: color-mix(in srgb, var(--color-pine) 8%, transparent);"
              >
                <Path size="1em" weight="bold" />
              </span>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="chip-ghost">{r.routeType === 'anfahrt' ? 'Anfahrt' : 'Rückegasse'}</span>
                  <span class="text-sm font-semibold text-ink">{r.name ?? '–'}</span>
                  <span class="text-xs text-content-muted">
                    {r.vehicleType === 'großgerät' ? 'auch Großgerät' : 'Kleingerät'}
                  </span>
                </div>
                {#if r.comment}
                  <p class="text-xs text-content-muted mt-1">{r.comment}</p>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="flex flex-col gap-3">
      <div class="flex items-baseline justify-between px-1">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Bäume
        </h2>
        <span class="eyebrow">{data.trees.length} gesamt</span>
      </div>

      {#each data.trees as t, i}
        <article
          class="paper px-5 py-4 flex flex-col gap-3 transition {t.status !== 'OPEN' ? 'opacity-80' : ''}"
        >
          <div class="flex items-start gap-3">
            {#if t.images.length > 0}
              <img
                src={t.images[0].url}
                alt=""
                class="w-20 h-20 object-cover rounded-btn border flex-shrink-0"
              />
            {:else}
              <div class="w-20 h-20 rounded-btn border border-dashed grid place-items-center text-content-faint bg-earth flex-shrink-0">
                <Tree size="1.5em" />
              </div>
            {/if}

            <div class="flex-1 min-w-0 flex flex-col gap-2">
              <div class="flex items-center justify-between gap-2">
                <span
                  class="numeral italic text-[1.125rem] text-ember"
                  style="font-variation-settings: 'opsz' 144, 'SOFT' 80, 'WONK' 1;"
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span class="font-mono text-xs text-content-muted">{t.id.slice(0, 8)}</span>
              </div>

              <div class="flex flex-wrap gap-1.5">
                {#if t.healthStatus}
                  <span class="health-pill {healthPillClass[t.healthStatus as HealthStatus]}">
                    {HEALTH_LABELS[t.healthStatus as HealthStatus]}
                  </span>
                {/if}
                {#each t.labels as l}
                  <span class="chip-ghost">{TREE_LABEL_LABELS[l as TreeLabel]}</span>
                {/each}
              </div>

              {#if t.description}
                <p class="text-xs text-content-muted leading-snug">{t.description}</p>
              {/if}

              <div class="text-[0.6875rem] font-mono text-content-faint">
                {t.latitude.toFixed(5)}, {t.longitude.toFixed(5)}
                {#if t.gpsAccuracyM}· ±{t.gpsAccuracyM.toFixed(0)} m{/if}
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-2 pt-2 border-t border-hairline">
            <button
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-btn border font-semibold text-[0.8125rem] transition {t.status === 'COMPLETED' ? 'bg-moss text-earth border-moss' : 'bg-earth text-content'}"
              onclick={() => markTree(t.assignmentId, 'COMPLETED')}
            >
              <CheckCircle size="1em" weight={t.status === 'COMPLETED' ? 'fill' : 'regular'} />
              <span>Erledigt</span>
            </button>
            <button
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-btn border font-semibold text-[0.8125rem] transition {t.status === 'PROBLEM' ? 'bg-amber text-pine-deep border-amber' : 'bg-earth text-content'}"
              onclick={() => markTree(t.assignmentId, 'PROBLEM', prompt('Problem:') ?? null)}
            >
              <WarningCircle size="1em" weight={t.status === 'PROBLEM' ? 'fill' : 'regular'} />
              <span>Problem</span>
            </button>
            <button
              class="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-btn border font-semibold text-[0.8125rem] transition {t.status === 'NOT_FOUND' ? 'bg-stone text-earth border-stone' : 'bg-earth text-content'}"
              onclick={() => markTree(t.assignmentId, 'NOT_FOUND')}
            >
              <Question size="1em" weight={t.status === 'NOT_FOUND' ? 'fill' : 'regular'} />
              <span>Nicht gefunden</span>
            </button>
          </div>

          {#if t.statusMessage}
            <p
              class="text-xs italic pl-3 border-l-2 text-content"
              style="border-color: var(--color-ember);"
            >
              Notiz: {t.statusMessage}
            </p>
          {/if}
        </article>
      {/each}
    </section>

    <section class="paper px-5 py-5 flex flex-col gap-3">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="02"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Notizen für den Besitzer
      </h2>
      <textarea
        class="w-full px-4 py-3 min-h-[96px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
        rows="3"
        bind:value={orderNotes}
        placeholder="Zustand der Wege, Besonderheiten, Rückfragen ..."
      ></textarea>
      <button
        class="self-end inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm shadow-duff transition hover:-translate-y-px hover:shadow-understory disabled:opacity-70 disabled:cursor-not-allowed"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        onclick={saveNotes}
        disabled={savingNotes}
      >
        {savingNotes ? 'Speichern …' : 'Speichern'}
      </button>
    </section>
  </main>
</div>
