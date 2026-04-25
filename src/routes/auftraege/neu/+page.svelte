<script lang="ts">
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import { ArrowLeft, ArrowRight, Tree, Polygon, Copy, Link as LinkIcon, Check, WhatsappLogo, X } from 'phosphor-svelte';
  import { HEALTH_LABELS, HEALTH_COLORS, TREE_TYPE_LABELS, TREE_LABEL_LABELS } from '$lib/enums';
  import { createWorkOrder } from './create-work-order.remote';

  let { data }: { data: PageData } = $props();

  let title = $state('');
  let instructions = $state('');
  // Default to no plot selected — user picks one explicitly.
  let plotId = $state<string>('');
  let mode = $state<'plot' | 'areas' | 'trees'>('plot');
  let selectedAreas = $state<Record<string, true>>({});
  let selectedTrees = $state<Record<string, true>>({});
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let shareOverlay = $state<{ orderId: string | null; shareUrl: string | null; title: string } | null>(null);
  let copied = $state(false);
  let overlayCloseArmed = $state(false);
  let overlayError = $state<string | null>(null);

  let vis = $state({
    anfahrten: true,
    plot_photos: true,
    areas: true,
    tree_photos: true,
    tree_descriptions: true,
    tree_health: true
  });

  const activePlot = $derived(data.plots.find((p) => p.id === plotId) ?? null);

  function onPlotChange() {
    selectedAreas = {};
    selectedTrees = {};
    mode = 'plot';
  }

  function toggleArea(id: string) {
    if (selectedAreas[id]) delete selectedAreas[id];
    else selectedAreas[id] = true;
  }
  function toggleTree(id: string) {
    if (selectedTrees[id]) delete selectedTrees[id];
    else selectedTrees[id] = true;
  }

  const selectedAreaIds = $derived(Object.keys(selectedAreas));
  const selectedTreeIds = $derived(Object.keys(selectedTrees));
  const backHref = $derived.by(() => {
    const from = page.url.searchParams.get('from');
    // Only allow internal paths to avoid open-redirects.
    if (from && from.startsWith('/')) return from;
    return '/auftraege';
  });

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') shareOverlay = null;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  async function copyLink() {
    if (!shareOverlay?.shareUrl) return;
    await navigator.clipboard.writeText(shareOverlay.shareUrl);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function remoteErrorMessage(e: unknown): string {
    if (e && typeof e === 'object' && 'body' in e) {
      const msg = (e as { body?: { message?: string } }).body?.message;
      if (msg) return msg;
    }
    if (e instanceof Error) return e.message;
    return 'Speichern fehlgeschlagen.';
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = null;
    if (!title.trim()) { error = 'Bitte einen Titel eingeben.'; return; }
    if (!plotId) { error = 'Bitte ein Waldstück auswählen.'; return; }

    let selection: Record<string, unknown>;
    if (mode === 'plot') {
      if (activePlot && activePlot.trees.length === 0) {
        error = 'Bitte mindestens einen Bereich oder einen Baum auswählen.';
        return;
      }
      selection = { type: 'plot', plotId };
    } else if (mode === 'areas') {
      if (selectedAreaIds.length === 0) { error = 'Bitte mindestens einen Bereich auswählen.'; return; }
      selection = { type: 'areas', plotId, areaIds: selectedAreaIds };
    } else {
      if (selectedTreeIds.length === 0) { error = 'Bitte mindestens einen Baum auswählen.'; return; }
      selection = { type: 'trees', treeIds: selectedTreeIds };
    }

    submitting = true;
    shareOverlay = { orderId: null, shareUrl: null, title: title.trim() };
    copied = false;
    overlayCloseArmed = false;
    overlayError = null;
    // Prevent the submit click from immediately closing the freshly opened overlay.
    queueMicrotask(() => (overlayCloseArmed = true));
    try {
      const { orderId, shareUrl } = await createWorkOrder({
        title: title.trim(),
        instructions,
        selection,
        visibility: vis
      });
      shareOverlay.orderId = orderId;
      shareOverlay.shareUrl = shareUrl;
    } catch (e) {
      overlayError = remoteErrorMessage(e);
    } finally {
      submitting = false;
    }
  }

  const visOptions = [
    { key: 'anfahrten', label: 'Anfahrten & Rückegassen' },
    { key: 'plot_photos', label: 'Waldstück-Fotos' },
    { key: 'areas', label: 'Bereiche' },
    { key: 'tree_photos', label: 'Baum-Fotos' },
    { key: 'tree_descriptions', label: 'Baum-Beschreibungen' },
    { key: 'tree_health', label: 'Gesundheitsstatus' }
  ] as const;
</script>

<div class="min-h-dvh bg-earth pb-12">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href={backHref}
        aria-label="Zurück"
        class="w-[38px] h-[38px] min-h-0 min-w-0 grid place-items-center rounded-btn border bg-surface text-ink hover:border-pine transition"
      >
        <ArrowLeft size="1.125em" weight="bold" />
      </a>
      <div class="flex-1 flex flex-col gap-[2px]">
        <span class="eyebrow">Neu anlegen</span>
        <h1
          class="font-serif font-medium text-[1.5rem] leading-none tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Neuer Auftrag
        </h1>
      </div>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <form onsubmit={submit} class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    {#if error}
      <div class="alert alert-error text-sm">{error}</div>
    {/if}

    <section class="paper px-5 py-5 flex flex-col gap-4">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="01"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Grundangaben
      </h2>

      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Titel</span>
        <input
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          required
          bind:value={title}
          placeholder="z. B. Sturmholz räumen"
        />
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Anweisungen</span>
        <textarea
          class="w-full px-4 py-3 min-h-[96px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          rows="4"
          bind:value={instructions}
          placeholder="Optionale Hinweise für das Forstunternehmen"
        ></textarea>
      </label>

      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Waldstück</span>
        <select
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          bind:value={plotId}
          onchange={onPlotChange}
          required
        >
          <option value="" disabled>— bitte wählen —</option>
          {#each data.plots as p}
            <option value={p.id}>{p.name ?? `Waldstück ${p.id.slice(0, 6)}`}</option>
          {/each}
        </select>
      </label>
    </section>

    {#if activePlot}
      <section class="paper px-5 py-5 flex flex-col gap-4">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="02"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Auswahl
        </h2>

        <div class="inline-flex p-1 bg-earth border rounded-pill self-start flex-wrap">
          <button
            type="button"
            class="px-4 py-2 min-h-0 min-w-0 rounded-pill text-[0.8125rem] font-semibold transition {mode === 'plot' ? 'text-earth bg-pine' : 'text-content-muted'}"
            onclick={() => (mode = 'plot')}
          >
            Ganzes Waldstück
          </button>
          <button
            type="button"
            class="px-4 py-2 min-h-0 min-w-0 rounded-pill text-[0.8125rem] font-semibold transition {mode === 'areas' ? 'text-earth bg-pine' : 'text-content-muted'}"
            disabled={activePlot.areas.length === 0}
            onclick={() => (mode = 'areas')}
          >
            Bereiche {activePlot.areas.length ? `(${activePlot.areas.length})` : ''}
          </button>
          <button
            type="button"
            class="px-4 py-2 min-h-0 min-w-0 rounded-pill text-[0.8125rem] font-semibold transition {mode === 'trees' ? 'text-earth bg-pine' : 'text-content-muted'}"
            disabled={activePlot.trees.length === 0}
            onclick={() => (mode = 'trees')}
          >
            Einzelne Bäume {activePlot.trees.length ? `(${activePlot.trees.length})` : ''}
          </button>
        </div>

        {#if mode === 'plot'}
          <p class="text-sm text-content-muted leading-relaxed">
            Alle {activePlot.trees.length} Bäume in diesem Waldstück werden in den Auftrag aufgenommen.
          </p>
        {:else if mode === 'areas'}
          {#if activePlot.areas.length === 0}
            <p class="text-sm text-content-muted">Für dieses Waldstück sind keine Bereiche eingezeichnet.</p>
          {:else}
            <ul class="flex flex-col divide-y divide-hairline border rounded-btn overflow-hidden bg-earth">
              {#each activePlot.areas as a}
                <li>
                  <label class="flex items-center gap-3 px-4 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={!!selectedAreas[a.id]}
                      onchange={() => toggleArea(a.id)}
                    />
                    <span class="grid place-items-center w-8 h-8 rounded-btn border border-hairline text-pine">
                      <Polygon size="1em" weight="duotone" />
                    </span>
                    <span class="flex-1 min-w-0 flex flex-col">
                      <span class="text-sm text-ink truncate">{a.comment?.trim() || 'Bereich ohne Kommentar'}</span>
                      {#if a.appliedTreeStatus}
                        <span class="text-xs text-content-muted">
                          Angewandter Status: <span class="font-semibold" style="color: {HEALTH_COLORS[a.appliedTreeStatus]};">{HEALTH_LABELS[a.appliedTreeStatus]}</span>
                        </span>
                      {/if}
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
            <p class="text-xs text-content-muted">
              {selectedAreaIds.length} Bereich{selectedAreaIds.length === 1 ? '' : 'e'} ausgewählt — alle darin liegenden Bäume gehen in den Auftrag.
            </p>
          {/if}
        {:else}
          {#if activePlot.trees.length === 0}
            <p class="text-sm text-content-muted">Für dieses Waldstück sind keine Bäume erfasst.</p>
          {:else}
            <ul class="flex flex-col divide-y divide-hairline border rounded-btn overflow-hidden bg-earth max-h-[420px] overflow-y-auto">
              {#each activePlot.trees as t}
                <li>
                  <label class="flex items-center gap-3 px-4 py-3 cursor-pointer">
                    <input
                      type="checkbox"
                      class="checkbox checkbox-sm"
                      checked={!!selectedTrees[t.id]}
                      onchange={() => toggleTree(t.id)}
                    />
                    <span
                      class="grid place-items-center w-8 h-8 rounded-btn border border-hairline"
                      style="color: {HEALTH_COLORS[t.healthStatus]};"
                    >
                      <Tree size="1em" weight="duotone" />
                    </span>
                    <span class="flex-1 min-w-0 flex flex-col">
                      <span class="text-sm text-ink truncate">
                        {TREE_TYPE_LABELS[t.treeTypeId]} · <span style="color: {HEALTH_COLORS[t.healthStatus]};">{HEALTH_LABELS[t.healthStatus]}</span>
                      </span>
                      {#if t.labels.length}
                        <span class="text-xs text-content-muted truncate">
                          {t.labels.map((l) => TREE_LABEL_LABELS[l]).join(' · ')}
                        </span>
                      {/if}
                    </span>
                  </label>
                </li>
              {/each}
            </ul>
            <p class="text-xs text-content-muted">
              {selectedTreeIds.length} Baum{selectedTreeIds.length === 1 ? '' : 'e'} ausgewählt.
            </p>
          {/if}
        {/if}
      </section>
    {/if}

    <section class="paper px-5 py-5 flex flex-col gap-4">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num={activePlot ? '03' : '02'}
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Was soll der Empfänger sehen?
      </h2>

      <div class="flex flex-col gap-2">
        {#each visOptions as opt}
          <label class="flex items-center justify-between gap-3 py-2 cursor-pointer">
            <span class="text-sm text-content">{opt.label}</span>
            <input
              type="checkbox"
              class="toggle toggle-primary toggle-sm"
              bind:checked={vis[opt.key as keyof typeof vis]}
            />
          </label>
        {/each}
      </div>

      <p class="text-xs text-content-muted leading-relaxed">
        Die Label-Aufgaben (Fällen / Markieren / Zaun bauen / Entasten) sind immer sichtbar — sie beschreiben die Arbeit.
      </p>
    </section>

    <button
      class="inline-flex items-center justify-between gap-3 px-5 py-3 min-h-[52px] rounded-btn text-earth border font-semibold text-[0.9375rem] shadow-understory transition hover:-translate-y-px hover:shadow-canopy disabled:opacity-70 disabled:cursor-not-allowed"
      style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
      disabled={submitting}
    >
      <span>{submitting ? 'Speichern …' : 'Auftrag erstellen'}</span>
      <ArrowRight size="1.125em" weight="bold" />
    </button>
  </form>

  {#if shareOverlay}
    <div
      class="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] px-4 py-6 grid place-items-center"
      role="presentation"
      onpointerdown={() => {
        if (!overlayCloseArmed) return;
        shareOverlay = null;
      }}
    >
      <div
        class="w-full max-w-lg bg-surface border rounded-box shadow-canopy overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Link teilen"
        onpointerdown={(e) => e.stopPropagation()}
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        tabindex="-1"
      >
        <div class="px-5 py-4 flex items-start justify-between gap-3 border-b border-hairline">
          <div class="flex flex-col gap-1 min-w-0">
            <span class="eyebrow">Auftrag erstellt</span>
            <h2 class="font-serif font-medium text-[1.125rem] tracking-tight text-ink m-0 truncate">
              Link teilen
            </h2>
          </div>
          <button
            type="button"
            class="w-[38px] h-[38px] grid place-items-center rounded-btn border bg-earth text-ink hover:border-pine transition"
            aria-label="Schließen"
            onclick={() => (shareOverlay = null)}
          >
            <X size="1.125em" weight="bold" />
          </button>
        </div>

        <div class="px-5 py-5 grid gap-4">
          <div class="flex flex-wrap items-stretch gap-2">
            <div
              class="flex-1 min-w-0 inline-flex items-center gap-2 px-3 py-2 min-h-[44px] rounded-btn border border-dashed bg-earth text-content text-xs font-mono"
            >
              <LinkIcon size="0.875em" weight="bold" />
              <span class="text-ink break-all leading-snug">
                {shareOverlay.shareUrl ?? 'Link wird erstellt …'}
              </span>
            </div>
            <button
              type="button"
              class="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-btn text-earth border font-semibold text-sm focus-ring"
              style="background: var(--color-pine); border-color: var(--color-pine-deep);"
              onclick={copyLink}
              disabled={!shareOverlay.shareUrl}
            >
              {#if copied}<Check size="1em" weight="bold" /> Kopiert{:else}<Copy size="1em" /> Kopieren{/if}
            </button>
          </div>

          {#if overlayError}
            <div class="alert alert-error text-sm">{overlayError}</div>
          {/if}

          <div class="flex flex-wrap gap-2">
            <a
              class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-content text-[0.8125rem] no-underline hover:border-pine hover:text-ink"
              target="_blank"
              rel="noopener"
              href={shareOverlay.shareUrl ? `https://wa.me/?text=${encodeURIComponent(shareOverlay.title + ' — ' + shareOverlay.shareUrl)}` : undefined}
              aria-disabled={!shareOverlay.shareUrl}
            >
              <WhatsappLogo size="1em" weight="fill" /> Per WhatsApp
            </a>
            <a
              class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-pill bg-earth border text-content text-[0.8125rem] no-underline hover:border-pine hover:text-ink"
              href={shareOverlay.orderId ? `/auftraege/${shareOverlay.orderId}` : undefined}
              aria-disabled={!shareOverlay.orderId}
            >
              Auftrag öffnen <ArrowRight size="1em" weight="bold" />
            </a>
          </div>

          <p class="text-xs text-content-muted leading-relaxed m-0">
            Tipp: Klick außerhalb schließt den Dialog (oder Esc).
          </p>
        </div>
      </div>
    </div>
  {/if}
</div>
