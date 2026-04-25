<script lang="ts">
  import type { PageData } from './$types';
  import {
    HEALTH_LABELS,
    HEALTH_COLORS,
    TREE_TYPE_LABELS,
    TREE_LABEL_LABELS,
    MATURITY_LABELS,
    maturityStage,
    type HealthStatus,
    type TreeType,
    type TreeLabel
  } from '$lib/enums';
  import { MapPin, ArrowLeft, PencilSimple } from 'phosphor-svelte';

  let { data }: { data: PageData } = $props();

  const h = $derived(data.tree.healthStatus as HealthStatus);
  const plantedAt = $derived(data.tree.estPlantedAt ? new Date(data.tree.estPlantedAt) : null);
  const maturity = $derived(maturityStage(data.tree.treeTypeId as TreeType, plantedAt));
  const plantedYear = $derived(plantedAt ? plantedAt.getFullYear() : null);

  const healthPillClass: Record<HealthStatus, string> = {
    healthy: 'health-pill--healthy',
    'must-watch': 'health-pill--must-watch',
    infected: 'health-pill--infected',
    dead: 'health-pill--dead'
  };
</script>

<div class="min-h-dvh bg-earth pb-12">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href="/"
        aria-label="Zurück zur Karte"
        class="w-[38px] h-[38px] min-h-0 min-w-0 grid place-items-center rounded-btn border bg-surface text-ink hover:border-pine transition"
      >
        <ArrowLeft size="1.125em" weight="bold" />
      </a>
      <div class="flex-1 flex flex-col gap-[2px] min-w-0">
        <span class="eyebrow">Baum · {data.plot.name ?? 'Unbenannt'}</span>
        <h1
          class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0 truncate"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          {TREE_TYPE_LABELS[data.tree.treeTypeId as TreeType]}
        </h1>
      </div>
      <a
        href="/baeume/{data.tree.id}/edit"
        aria-label="Bearbeiten"
        class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-ink text-sm font-semibold no-underline hover:border-pine transition"
      >
        <PencilSimple size="1em" /> Bearbeiten
      </a>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    {#if data.images.length > 0}
      <div
        class="relative rounded-box overflow-hidden border shadow-understory"
        style="background: var(--color-pine-deep);"
      >
        <div class="carousel w-full">
          {#each data.images as img, i}
            <div class="carousel-item w-full">
              <img
                src={img.url}
                alt="Baum-Foto {i + 1}"
                class="w-full object-contain max-h-[28rem]"
              />
            </div>
          {/each}
        </div>
        <span
          class="absolute top-3 left-3 inline-flex items-center gap-2 px-3 py-1 rounded-pill text-[0.6875rem] tracking-caps uppercase font-semibold border"
          style="background: color-mix(in srgb, var(--color-pine-deep) 70%, transparent); color: var(--color-earth); border-color: color-mix(in srgb, var(--color-earth) 20%, transparent);"
        >
          {data.images.length} Foto{data.images.length === 1 ? '' : 's'}
        </span>
      </div>
    {/if}

    <!-- Health hero -->
    <section class="paper-elevated px-5 py-5 flex items-center gap-4">
      <span
        class="w-12 h-12 rounded-full grid place-items-center shadow-duff flex-shrink-0"
        style="background: {HEALTH_COLORS[h]};"
        aria-hidden="true"
      ></span>
      <div class="flex-1 flex flex-col gap-1 min-w-0">
        <span class="eyebrow">Gesundheit</span>
        <span class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink">
          {HEALTH_LABELS[h]}
        </span>
      </div>
      <span class="health-pill {healthPillClass[h]}">{HEALTH_LABELS[h]}</span>
    </section>

    <!-- Metadata grid -->
    <section class="paper px-5 py-5 grid gap-5 sm:grid-cols-2">
      <div class="flex flex-col gap-1">
        <span class="eyebrow">Baumart</span>
        <span class="font-serif font-medium text-lg text-ink tracking-tight">
          {TREE_TYPE_LABELS[data.tree.treeTypeId as TreeType]}
        </span>
      </div>

      <div class="flex flex-col gap-1">
        <span class="eyebrow">Reifegrad</span>
        <span class="font-serif font-medium text-lg text-ink tracking-tight">
          {MATURITY_LABELS[maturity]}
        </span>
        {#if plantedYear}
          <span class="text-xs text-content-muted leading-snug">
            Berechnet aus Pflanzjahr {plantedYear}. Passt nicht?
            <a href="/baeume/{data.tree.id}/edit" class="text-pine font-semibold no-underline hover:underline">Anpassen</a>
          </span>
        {:else}
          <span class="text-xs text-content-muted leading-snug">
            Kein Pflanzjahr hinterlegt.
            <a href="/baeume/{data.tree.id}/edit" class="text-pine font-semibold no-underline hover:underline">Ergänzen</a>
          </span>
        {/if}
      </div>

      <div class="flex flex-col gap-2 sm:col-span-2">
        <span class="eyebrow flex items-center gap-1"><MapPin size="0.875em" weight="bold" /> Position</span>
        <div class="inline-flex items-center gap-2 px-3 py-2 rounded-btn border border-dashed bg-earth font-mono text-[0.8125rem] text-content self-start">
          <span>{data.tree.latitude.toFixed(6)}</span>
          <span class="text-content-faint">·</span>
          <span>{data.tree.longitude.toFixed(6)}</span>
        </div>
        {#if data.tree.gpsAccuracyM != null}
          <span class="text-xs text-content-muted">
            Genauigkeit: ±{data.tree.gpsAccuracyM.toFixed(1)} m
          </span>
        {/if}
      </div>

      {#if data.tree.labels.length > 0}
        <div class="flex flex-col gap-2 sm:col-span-2">
          <span class="eyebrow">Aufgaben</span>
          <div class="flex flex-wrap gap-2">
            {#each data.tree.labels as l}
              <span
                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-pill text-earth text-[0.8125rem] font-semibold"
                style="background: var(--color-pine);"
              >
                {TREE_LABEL_LABELS[l as TreeLabel]}
              </span>
            {/each}
          </div>
        </div>
      {/if}

      {#if data.tree.description}
        <div class="flex flex-col gap-2 sm:col-span-2 pt-3 border-t border-hairline">
          <span class="eyebrow">Notiz</span>
          <p
            class="font-serif italic text-base text-content pl-3 border-l-2 whitespace-pre-wrap"
            style="border-color: var(--color-ember);"
          >
            {data.tree.description}
          </p>
        </div>
      {/if}
    </section>
  </main>
</div>
