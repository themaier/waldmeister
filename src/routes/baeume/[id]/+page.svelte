<script lang="ts">
  import type { PageData } from './$types';
  import {
    HEALTH_LABELS,
    HEALTH_COLORS,
    HEALTH_STATUSES,
    TREE_TYPES,
    TREE_TYPE_LABELS,
    TREE_LABELS,
    TREE_LABEL_LABELS,
    MATURITY_LABELS,
    maturityStage,
    type HealthStatus,
    type TreeType,
    type TreeLabel
  } from '$lib/enums';
  import { MapPin, ArrowLeft, PencilSimple, Check, X } from 'phosphor-svelte';
  import { invalidateAll } from '$app/navigation';
  import { updateTree } from '../../trees.remote';

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

  type Field = 'health' | 'type' | 'labels' | 'planted' | 'description';
  let editing = $state<Field | null>(null);
  let saving = $state(false);
  let errorMsg = $state<string | null>(null);

  // Local edit buffers — populated on startEdit, ignored otherwise.
  let editHealth = $state<HealthStatus>('healthy');
  let editType = $state<TreeType>('fichte');
  let editLabels = $state<TreeLabel[]>([]);
  let editPlantedAt = $state('');
  let editPlantedAge = $state('');
  let editDescription = $state('');

  function startEdit(field: Field) {
    editing = field;
    errorMsg = null;
    editHealth = data.tree.healthStatus as HealthStatus;
    editType = data.tree.treeTypeId as TreeType;
    editLabels = [...(data.tree.labels as TreeLabel[])];
    editPlantedAt = data.tree.estPlantedAt ?? '';
    editPlantedAge = '';
    editDescription = data.tree.description ?? '';
  }

  function cancelEdit() {
    editing = null;
    errorMsg = null;
  }

  function toggleEditLabel(l: TreeLabel) {
    if (editLabels.includes(l)) editLabels = editLabels.filter((x) => x !== l);
    else editLabels = [...editLabels, l];
  }

  function formatYmd(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function setEditPlantedAt(v: string) {
    editPlantedAt = v;
    if (!v) {
      editPlantedAge = '';
      return;
    }
    const d = new Date(v);
    if (isNaN(d.getTime())) return;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    if (age < 0) age = 0;
    editPlantedAge = String(age);
  }

  function setEditPlantedAge(v: string) {
    editPlantedAge = v;
    if (v === '') return;
    const age = Number(v);
    if (!Number.isFinite(age) || age < 0) return;
    const base = editPlantedAt ? new Date(editPlantedAt) : new Date();
    if (isNaN(base.getTime())) return;
    const target = new Date(base);
    target.setFullYear(base.getFullYear() - age);
    editPlantedAt = formatYmd(target);
  }

  async function save(patch: Record<string, unknown>) {
    saving = true;
    errorMsg = null;
    try {
      await updateTree({ id: data.tree.id, ...patch });
      await invalidateAll();
      editing = null;
    } catch (e) {
      errorMsg = (e as { message?: string }).message ?? 'Speichern fehlgeschlagen.';
    } finally {
      saving = false;
    }
  }

  const saveHealth = () => save({ healthStatus: editHealth });
  const saveType = () => save({ treeTypeId: editType });
  const saveLabels = () => save({ labels: editLabels });
  const savePlanted = () => save({ estPlantedAt: editPlantedAt || null });
  const saveDescription = () => save({ description: editDescription.trim() || null });
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
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    {#if errorMsg}
      <div class="alert alert-error text-sm">{errorMsg}</div>
    {/if}

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
    <section class="paper-elevated px-5 py-5 flex flex-col gap-3">
      {#if editing === 'health'}
        <div class="flex items-center justify-between gap-2">
          <span class="eyebrow">Gesundheit bearbeiten</span>
          <div class="flex gap-2">
            <button class="edit-btn" aria-label="Abbrechen" onclick={cancelEdit} disabled={saving}>
              <X size="1em" weight="bold" />
            </button>
            <button class="edit-btn edit-btn--primary" aria-label="Speichern" onclick={saveHealth} disabled={saving}>
              <Check size="1em" weight="bold" />
            </button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2">
          {#each HEALTH_STATUSES as opt}
            <button
              type="button"
              class="toggle-chip {editHealth === opt ? 'is-on' : ''}"
              aria-pressed={editHealth === opt}
              onclick={() => (editHealth = opt)}
            >
              <span class="w-2 h-2 rounded-full" style="background: var(--health-{opt});"></span>
              {HEALTH_LABELS[opt]}
            </button>
          {/each}
        </div>
      {:else}
        <div class="flex items-center gap-4">
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
          <button class="edit-btn" aria-label="Gesundheit bearbeiten" onclick={() => startEdit('health')}>
            <PencilSimple size="1em" />
          </button>
        </div>
      {/if}
    </section>

    <!-- Metadata grid -->
    <section class="paper px-5 py-5 grid gap-5 sm:grid-cols-2">
      <!-- Tree type -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="eyebrow">Baumart</span>
          {#if editing === 'type'}
            <div class="flex gap-2">
              <button class="edit-btn" aria-label="Abbrechen" onclick={cancelEdit} disabled={saving}>
                <X size="1em" weight="bold" />
              </button>
              <button class="edit-btn edit-btn--primary" aria-label="Speichern" onclick={saveType} disabled={saving}>
                <Check size="1em" weight="bold" />
              </button>
            </div>
          {:else}
            <button class="edit-btn" aria-label="Baumart bearbeiten" onclick={() => startEdit('type')}>
              <PencilSimple size="1em" />
            </button>
          {/if}
        </div>
        {#if editing === 'type'}
          <select
            class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
            bind:value={editType}
          >
            {#each TREE_TYPES as t}
              <option value={t}>{TREE_TYPE_LABELS[t]}</option>
            {/each}
          </select>
        {:else}
          <span class="font-serif font-medium text-lg text-ink tracking-tight">
            {TREE_TYPE_LABELS[data.tree.treeTypeId as TreeType]}
          </span>
        {/if}
      </div>

      <!-- Maturity / Planted -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <span class="eyebrow">Reifegrad</span>
          {#if editing === 'planted'}
            <div class="flex gap-2">
              <button class="edit-btn" aria-label="Abbrechen" onclick={cancelEdit} disabled={saving}>
                <X size="1em" weight="bold" />
              </button>
              <button class="edit-btn edit-btn--primary" aria-label="Speichern" onclick={savePlanted} disabled={saving}>
                <Check size="1em" weight="bold" />
              </button>
            </div>
          {:else}
            <button class="edit-btn" aria-label="Pflanzjahr bearbeiten" onclick={() => startEdit('planted')}>
              <PencilSimple size="1em" />
            </button>
          {/if}
        </div>
        {#if editing === 'planted'}
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span class="text-[0.75rem] font-semibold text-content-muted">Pflanzjahr</span>
              <input
                type="date"
                class="w-full px-3 py-2 min-h-[44px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
                bind:value={() => editPlantedAt, setEditPlantedAt}
              />
            </label>
            <label class="flex flex-col gap-1">
              <span class="text-[0.75rem] font-semibold text-content-muted">Alter (Jahre)</span>
              <input
                type="number"
                min="0"
                class="w-full px-3 py-2 min-h-[44px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
                bind:value={() => editPlantedAge, setEditPlantedAge}
              />
            </label>
          </div>
        {:else}
          <span class="font-serif font-medium text-lg text-ink tracking-tight">
            {MATURITY_LABELS[maturity]}
          </span>
          {#if plantedYear}
            <span class="text-xs text-content-muted leading-snug">
              Berechnet aus Pflanzjahr {plantedYear}. Passt nicht?
              <button class="text-pine font-semibold no-underline hover:underline" onclick={() => startEdit('planted')}>Anpassen</button>
            </span>
          {:else}
            <span class="text-xs text-content-muted leading-snug">
              Kein Pflanzjahr hinterlegt.
              <button class="text-pine font-semibold no-underline hover:underline" onclick={() => startEdit('planted')}>Ergänzen</button>
            </span>
          {/if}
        {/if}
      </div>

      <!-- Position (read-only) -->
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

      <!-- Labels -->
      <div class="flex flex-col gap-2 sm:col-span-2">
        <div class="flex items-center justify-between gap-2">
          <span class="eyebrow">Aufgaben</span>
          {#if editing === 'labels'}
            <div class="flex gap-2">
              <button class="edit-btn" aria-label="Abbrechen" onclick={cancelEdit} disabled={saving}>
                <X size="1em" weight="bold" />
              </button>
              <button class="edit-btn edit-btn--primary" aria-label="Speichern" onclick={saveLabels} disabled={saving}>
                <Check size="1em" weight="bold" />
              </button>
            </div>
          {:else}
            <button class="edit-btn" aria-label="Aufgaben bearbeiten" onclick={() => startEdit('labels')}>
              <PencilSimple size="1em" />
            </button>
          {/if}
        </div>
        {#if editing === 'labels'}
          <div class="flex flex-wrap gap-2">
            {#each TREE_LABELS as l}
              <button
                type="button"
                class="toggle-chip {editLabels.includes(l) ? 'is-on' : ''}"
                aria-pressed={editLabels.includes(l)}
                onclick={() => toggleEditLabel(l)}
              >
                {TREE_LABEL_LABELS[l]}
              </button>
            {/each}
          </div>
        {:else if data.tree.labels.length > 0}
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
        {:else}
          <span class="text-xs text-content-muted">Keine Aufgaben hinterlegt.</span>
        {/if}
      </div>

      <!-- Description -->
      <div class="flex flex-col gap-2 sm:col-span-2 pt-3 border-t border-hairline">
        <div class="flex items-center justify-between gap-2">
          <span class="eyebrow">Notiz</span>
          {#if editing === 'description'}
            <div class="flex gap-2">
              <button class="edit-btn" aria-label="Abbrechen" onclick={cancelEdit} disabled={saving}>
                <X size="1em" weight="bold" />
              </button>
              <button class="edit-btn edit-btn--primary" aria-label="Speichern" onclick={saveDescription} disabled={saving}>
                <Check size="1em" weight="bold" />
              </button>
            </div>
          {:else}
            <button class="edit-btn" aria-label="Notiz bearbeiten" onclick={() => startEdit('description')}>
              <PencilSimple size="1em" />
            </button>
          {/if}
        </div>
        {#if editing === 'description'}
          <textarea
            class="w-full px-4 py-3 min-h-[96px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
            rows="3"
            bind:value={editDescription}
            placeholder="Auffälligkeiten, Kontext, freie Notiz"
          ></textarea>
        {:else if data.tree.description}
          <p
            class="font-serif italic text-base text-content pl-3 border-l-2 whitespace-pre-wrap"
            style="border-color: var(--color-ember);"
          >
            {data.tree.description}
          </p>
        {:else}
          <span class="text-xs text-content-muted">Keine Notiz.</span>
        {/if}
      </div>
    </section>
  </main>
</div>

<style>
  .edit-btn {
    width: 36px;
    height: 36px;
    min-height: 0;
    min-width: 0;
    display: grid;
    place-items: center;
    border-radius: var(--radius-btn, 0.5rem);
    background: var(--color-surface);
    color: var(--color-ink);
    border: 1px solid var(--color-hairline);
    transition: border-color 0.15s ease, background 0.15s ease;
  }
  .edit-btn:hover:not(:disabled) {
    border-color: var(--color-pine);
  }
  .edit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .edit-btn--primary {
    background: var(--color-pine);
    color: var(--color-earth);
    border-color: var(--color-pine-deep);
  }
  .edit-btn--primary:hover:not(:disabled) {
    background: var(--color-pine-deep);
  }
</style>
