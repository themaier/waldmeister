<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import { ArrowLeft, Tree, MapPin, Camera, Polygon, PencilSimple, Trash, Plus, MapTrifold, X } from 'phosphor-svelte';
  import { renamePlot, deletePlot } from '../../plots.remote';
  import { createBoundaryStone, deleteBoundaryStone, updateBoundaryStone } from '../../boundary-stones.remote';
  import { getBetterGpsFix, type GpsFix } from '$lib/gps';

  let { data }: { data: PageData } = $props();

  let stoneFile = $state<File | null>(null);
  let stonePreview = $state<string | null>(null);
  let stoneDescription = $state('');
  let stoneCaptureGps = $state(true);
  let stoneGps = $state<GpsFix | null>(null);
  let stoneGpsCapturing = $state(false);
  let stoneSubmitting = $state(false);
  let stoneError = $state<string | null>(null);
  let editing = $state<Record<string, string>>({});
  let showStoneForm = $state(false);

  function openStoneForm() {
    showStoneForm = true;
  }

  function closeStoneForm() {
    clearStoneDraft();
    showStoneForm = false;
  }

  async function rename() {
    const name = prompt('Name', data.plot.name ?? '');
    if (name === null) return;
    await renamePlot({ id: data.plot.id, name });
    location.reload();
  }

  async function remove() {
    if (!confirm('Waldstück und alle enthaltenen Daten (Bäume, Bereiche, Fotos, Anfahrten) löschen?')) return;
    await deletePlot(data.plot.id);
    location.href = '/';
  }

  async function imageSize(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
    });
  }

  function pickStoneFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    if (stonePreview) URL.revokeObjectURL(stonePreview);
    stoneFile = f;
    stonePreview = URL.createObjectURL(f);
    stoneError = null;
    stoneGps = null;
    if (stoneCaptureGps && !stoneGpsCapturing) {
      stoneGpsCapturing = true;
      getBetterGpsFix({ minWaitMs: 3000, maxWaitMs: 6500, desiredAccuracyM: 10 })
        .then((fix) => {
          stoneGps = fix;
        })
        .finally(() => {
          stoneGpsCapturing = false;
        });
    }
    input.value = '';
  }

  function clearStoneDraft() {
    if (stonePreview) URL.revokeObjectURL(stonePreview);
    stoneFile = null;
    stonePreview = null;
    stoneDescription = '';
    stoneError = null;
    stoneGps = null;
    stoneGpsCapturing = false;
  }

  async function submitStone() {
    if (!stoneFile || !stonePreview) {
      stoneError = 'Bitte ein Foto auswählen.';
      return;
    }
    stoneSubmitting = true;
    stoneError = null;
    try {
      const { width, height } = await imageSize(stonePreview);
      const gps =
        stoneCaptureGps
          ? stoneGps ??
            (await getBetterGpsFix({ minWaitMs: 3000, maxWaitMs: 7000, desiredAccuracyM: 10 }))
          : null;

      let result: { id: string; uploadUrl: string; contentType: string };
      try {
        result = await createBoundaryStone({
          plotId: data.plot.id,
          description: stoneDescription,
          latitude: gps?.lat ?? null,
          longitude: gps?.lng ?? null,
          gpsAccuracyM: gps?.acc ?? null,
          contentType: stoneFile.type || 'image/jpeg',
          widthPx: width,
          heightPx: height
        });
      } catch (e) {
        stoneError = (e as { message?: string }).message ?? 'Speichern fehlgeschlagen.';
        return;
      }

      if (!result.uploadUrl) {
        stoneError =
          'Keine Upload-URL vom Server (S3 presign fehlgeschlagen). Prüfe S3_* in .env und die Server-Logs.';
        return;
      }
      const put = await fetch(result.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': result.contentType },
        body: stoneFile
      });
      if (!put.ok) {
        stoneError = `Foto-Upload fehlgeschlagen (HTTP ${put.status}). Bei Cloudflare R2: CORS für PUT von deinem App-Ursprung erlauben (siehe https://developers.cloudflare.com/r2/buckets/cors/).`;
        return;
      }

      clearStoneDraft();
      showStoneForm = false;
      await invalidateAll();
    } finally {
      stoneSubmitting = false;
    }
  }

  async function removeStone(id: string) {
    if (!confirm('Diesen Grenzstein löschen?')) return;
    await deleteBoundaryStone(id);
    await invalidateAll();
  }

  function startEdit(id: string, current: string) {
    editing[id] = current;
  }
  function cancelEdit(id: string) {
    delete editing[id];
  }
  async function saveEdit(id: string) {
    const text = editing[id] ?? '';
    await updateBoundaryStone({ id, description: text });
    delete editing[id];
    await invalidateAll();
  }

  const stats = $derived([
    { label: 'Flurstücke', Icon: Polygon, value: data.counts.parcels },
    { label: 'Bäume', Icon: Tree, value: data.counts.trees },
    { label: 'Wege', Icon: MapPin, value: data.counts.routes },
    { label: 'Fotos', Icon: Camera, value: data.counts.photos }
  ]);
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
        <span class="eyebrow">Waldstück</span>
        <h1
          class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0 truncate"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          {data.plot.name ?? 'Unbenanntes Waldstück'}
        </h1>
      </div>
      <button
        class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-ink text-sm font-semibold hover:border-pine transition"
        onclick={rename}
      >
        <PencilSimple size="1em" /> Umbenennen
      </button>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-5">
    <!-- Editorial stats grid -->
    <section class="grid grid-cols-2 gap-3 sm:gap-4">
      {#each stats as s}
        {@const Icon = s.Icon}
        <div class="relative overflow-hidden paper px-5 pt-5 pb-5 flex flex-col gap-2">
          <span
            class="absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-btn text-pine border border-hairline"
            style="background: color-mix(in srgb, var(--color-pine) 8%, transparent);"
          >
            <Icon size="1.125em" weight="duotone" />
          </span>
          <span class="eyebrow">{s.label}</span>
          <span class="numeral text-[2.5rem] leading-none text-ink">{s.value}</span>
        </div>
      {/each}
    </section>

    <section class="paper px-5 py-5 flex flex-col gap-4">
      <div class="flex items-baseline justify-between gap-3">
        <h2
          class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
          data-num="01"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Grenzsteine
        </h2>
        <span class="eyebrow">{data.counts.stones} erfasst</span>
      </div>
      <p class="text-sm text-content-muted leading-relaxed">
        Foto, Beschreibung und (optional) Standort jedes Grenzsteins.
      </p>

      {#if data.boundaryStones.length > 0}
        <ul class="flex flex-col gap-3">
          {#each data.boundaryStones as st (st.id)}
            <li class="flex gap-3 items-start border border-hairline rounded-btn p-3 bg-earth">
              {#if st.url}
                <a href={st.url} target="_blank" rel="noopener" class="block flex-shrink-0">
                  <img
                    src={st.url}
                    alt="Grenzstein"
                    class="w-24 h-24 object-cover rounded-btn border"
                  />
                </a>
              {:else}
                <div class="w-24 h-24 rounded-btn border border-dashed grid place-items-center text-content-faint flex-shrink-0">
                  <Camera size="1.25em" />
                </div>
              {/if}
              <div class="flex-1 min-w-0 flex flex-col gap-2">
                {#if editing[st.id] !== undefined}
                  <textarea
                    class="w-full px-3 py-2 min-h-[64px] rounded-btn border bg-surface text-[0.9rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
                    rows="3"
                    bind:value={editing[st.id]}
                  ></textarea>
                  <div class="flex gap-2">
                    <button
                      class="px-3 py-1.5 min-h-[36px] rounded-btn text-earth border font-semibold text-xs"
                      style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
                      onclick={() => saveEdit(st.id)}
                    >
                      Speichern
                    </button>
                    <button
                      class="px-3 py-1.5 min-h-[36px] rounded-btn bg-surface border text-content text-xs font-semibold"
                      onclick={() => cancelEdit(st.id)}
                    >
                      Abbrechen
                    </button>
                  </div>
                {:else}
                  <p class="text-sm text-ink whitespace-pre-wrap leading-snug min-h-[1em]">
                    {st.description?.trim() || '— keine Beschreibung —'}
                  </p>
                {/if}
                <div class="flex flex-wrap items-center gap-2 text-xs text-content-muted">
                  {#if st.latitude !== null && st.longitude !== null}
                    <span class="inline-flex items-center gap-1 font-mono">
                      <MapTrifold size="0.875em" />
                      {st.latitude.toFixed(5)}, {st.longitude.toFixed(5)}
                      {#if st.gpsAccuracyM != null}· ±{st.gpsAccuracyM.toFixed(0)} m{/if}
                    </span>
                  {:else}
                    <span class="italic">ohne Standort</span>
                  {/if}
                </div>
                {#if editing[st.id] === undefined}
                  <div class="flex gap-2">
                    <button
                      class="inline-flex items-center gap-1 px-2 py-1 min-h-[32px] rounded-btn border text-content text-xs hover:border-pine transition"
                      onclick={() => startEdit(st.id, st.description)}
                    >
                      <PencilSimple size="0.875em" /> Beschreibung
                    </button>
                    <button
                      class="inline-flex items-center gap-1 px-2 py-1 min-h-[32px] rounded-btn border text-crimson text-xs hover:border-crimson transition"
                      onclick={() => removeStone(st.id)}
                    >
                      <Trash size="0.875em" /> Löschen
                    </button>
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Add new -->
      {#if !showStoneForm}
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[44px] rounded-btn bg-surface border text-ink text-sm font-semibold hover:border-pine transition self-start"
          onclick={openStoneForm}
        >
          <Plus size="1em" weight="bold" />
          Grenzstein hinzufügen
        </button>
      {:else}
      <div class="relative border border-dashed border-hairline rounded-btn p-4 pr-12 flex flex-col gap-3">
        <button
          type="button"
          aria-label="Abbrechen"
          class="absolute top-2 right-2 w-9 h-9 grid place-items-center rounded-btn border bg-surface text-content hover:border-pine hover:text-ink transition"
          onclick={closeStoneForm}
        >
          <X size="1em" weight="bold" />
        </button>
        <span class="eyebrow">Neuer Grenzstein</span>

        {#if stoneError}
          <div class="alert alert-error text-xs">{stoneError}</div>
        {/if}

        {#if stonePreview}
          <img
            src={stonePreview}
            alt="Vorschau"
            class="w-full max-w-[240px] h-auto rounded-btn border self-start"
          />
        {/if}

        <label class="inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[44px] rounded-btn bg-surface border text-ink text-sm font-semibold cursor-pointer hover:border-pine transition self-start">
          <Camera size="1em" />
          {stonePreview ? 'Anderes Foto' : 'Foto auswählen'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            class="sr-only"
            onchange={pickStoneFile}
          />
        </label>

        {#if stoneCaptureGps && (stoneGpsCapturing || stoneGps)}
          <div class="text-xs text-content-muted">
            {#if stoneGpsCapturing}
              GPS wird ermittelt …
            {:else if stoneGps}
              Standort: <span class="font-mono">{stoneGps.lat.toFixed(5)}, {stoneGps.lng.toFixed(5)}</span>
              · ±{stoneGps.acc.toFixed(0)} m
            {/if}
          </div>
        {/if}

        <textarea
          class="w-full px-3 py-2 min-h-[64px] rounded-btn border bg-surface text-[0.9rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          rows="2"
          placeholder="Beschreibung (z. B. Lage, Markierungen)"
          bind:value={stoneDescription}
        ></textarea>

        <label class="flex items-center gap-2 text-xs text-content cursor-pointer">
          <input type="checkbox" class="checkbox checkbox-sm" bind:checked={stoneCaptureGps} />
          <span>Aktuellen Standort mitspeichern</span>
        </label>

        <div class="flex gap-2">
          <button
            class="inline-flex items-center gap-2 px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm shadow-duff transition hover:-translate-y-px hover:shadow-understory disabled:opacity-70 disabled:cursor-not-allowed"
            style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
            onclick={submitStone}
            disabled={stoneSubmitting || !stoneFile}
          >
            <Plus size="1em" weight="bold" />
            {stoneSubmitting ? 'Speichern …' : 'Hinzufügen'}
          </button>
          {#if stoneFile}
            <button
              class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-content text-sm font-semibold"
              onclick={clearStoneDraft}
            >
              Verwerfen
            </button>
          {/if}
        </div>
      </div>
      {/if}
    </section>

    <section class="paper px-5 py-5 flex flex-col gap-3">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="02"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Aktionen
      </h2>
      <p class="text-sm text-content-muted leading-relaxed">
        Verwalte dein Waldstück. Das Löschen entfernt alle zugehörigen Daten unwiderruflich.
      </p>
      <button
        class="inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] rounded-btn font-semibold text-sm text-earth border transition hover:-translate-y-px hover:shadow-understory"
        style="background: var(--color-crimson); border-color: color-mix(in srgb, var(--color-crimson) 75%, black);"
        onclick={remove}
      >
        <Trash size="1em" weight="bold" />
        Waldstück löschen
      </button>
    </section>
  </main>
</div>
