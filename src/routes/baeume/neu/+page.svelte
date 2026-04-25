<script lang="ts">
  import { goto } from '$app/navigation';
  import { Camera, MapPin, Crosshair, Trash, Plus } from 'phosphor-svelte';
  import Map from '$lib/components/Map.svelte';
  import maplibregl from 'maplibre-gl';
  import {
    TREE_TYPES,
    TREE_TYPE_LABELS,
    HEALTH_STATUSES,
    HEALTH_LABELS,
    TREE_LABELS,
    TREE_LABEL_LABELS,
    type HealthStatus,
    type TreeLabel,
    type TreeType
  } from '$lib/enums';
  import type { PageData } from './$types';
  import { untrack } from 'svelte';
  import { createTree } from '../../trees.remote';
  import { getBetterGpsFix } from '$lib/gps';

  let { data }: { data: PageData } = $props();

  // untrack: form fields take the initial load value once and are then edited
  // locally — resyncing to data changes would clobber the user's input.
  let latitude = $state<number | null>(untrack(() => data.initial.latitude));
  let longitude = $state<number | null>(untrack(() => data.initial.longitude));
  let gpsAccuracyM = $state<number | null>(untrack(() => data.initial.gpsAccuracyM));
  let treeTypeId = $state<TreeType>('fichte');
  let healthStatus = $state<HealthStatus>('healthy');
  let labels = $state<TreeLabel[]>([]);
  let description = $state('');
  let estPlantedAt = $state('');
  let estPlantedAge = $state('');

  function formatYmd(d: Date) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function setPlantedAt(v: string) {
    estPlantedAt = v;
    if (!v) {
      estPlantedAge = '';
      return;
    }
    const d = new Date(v);
    if (isNaN(d.getTime())) return;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    if (age < 0) age = 0;
    estPlantedAge = String(age);
  }

  function setPlantedAge(v: string) {
    estPlantedAge = v;
    if (v === '') return;
    const age = Number(v);
    if (!Number.isFinite(age) || age < 0) return;
    const existing = estPlantedAt ? new Date(estPlantedAt) : null;
    const hasExisting = existing && !isNaN(existing.getTime());
    const now = new Date();
    const month = hasExisting ? existing.getMonth() : now.getMonth();
    const day = hasExisting ? existing.getDate() : now.getDate();
    const year = now.getFullYear() - age;
    estPlantedAt = formatYmd(new Date(year, month, day));
  }
  let images = $state<{ file: File; preview: string; width: number; height: number }[]>([]);
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let gpsCapturing = $state(false);
  let gpsFirstFixPending = $state(untrack(() => data.initial.latitude === null || data.initial.longitude === null));
  let gpsMode = $state<'auto' | 'manual'>('auto');
  let gpsImprovementCount = $state(0);
  let gpsRefineStartedAt = $state<number | null>(null);
  let gpsRefineLastImprovedAt = $state<number | null>(null);
  let gpsWatchId = $state<number | null>(null);
  let gpsRefineStopTimer = $state<number | null>(null);
  let gpsAutoStarted = $state(false);
  let gpsZoomBoostApplied = $state(false);
  let cameraInputEl = $state<HTMLInputElement | null>(null);
  let mapRef = $state<{ instance: () => maplibregl.Map | null } | null>(null);
  let marker = $state<maplibregl.Marker | null>(null);

  const lowAccuracy = $derived(gpsAccuracyM !== null && gpsAccuracyM > 10);
  const gpsRefining = $derived(gpsCapturing && !gpsFirstFixPending);
  const gpsRefineSeconds = $derived(
    gpsRefineStartedAt === null ? 0 : Math.max(0, Math.round((Date.now() - gpsRefineStartedAt) / 1000))
  );

  const GPS_REFINE_MS = 45_000;

  function stopGpsRefine() {
    if (gpsWatchId !== null) {
      navigator.geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
    if (gpsRefineStopTimer !== null) {
      window.clearTimeout(gpsRefineStopTimer);
      gpsRefineStopTimer = null;
    }
    gpsCapturing = false;
    gpsRefineStartedAt = null;
  }

  function acceptFixIfBetter(fix: { lat: number; lng: number; acc: number }) {
    if (gpsMode !== 'auto') return;
    if (gpsAccuracyM !== null && fix.acc >= gpsAccuracyM) return; // never worsen
    latitude = fix.lat;
    longitude = fix.lng;
    gpsAccuracyM = fix.acc;
    gpsFirstFixPending = false;
    gpsImprovementCount += 1;
    gpsRefineLastImprovedAt = Date.now();

    const map = mapRef?.instance();
    if (map) {
      const nextZoom = gpsZoomBoostApplied ? map.getZoom() : Math.min(map.getZoom() + 6, 19);
      gpsZoomBoostApplied = true;
      map.flyTo({ center: [fix.lng, fix.lat], zoom: nextZoom, essential: true });
    }
  }

  function setCoordsFromMarker(lng: number, lat: number) {
    gpsMode = 'manual';
    stopGpsRefine();
    latitude = lat;
    longitude = lng;
    gpsAccuracyM = null; // manual placement
  }

  async function retakeGps() {
    if (!('geolocation' in navigator)) {
      error = 'GPS nicht verfügbar.';
      return;
    }
    error = null;
    gpsMode = 'auto';
    gpsImprovementCount = 0;
    gpsRefineStartedAt = Date.now();
    gpsRefineLastImprovedAt = null;
    gpsFirstFixPending = true;
    gpsZoomBoostApplied = false;
    // Clear any previous manual accuracy label immediately so the user sees the reset.
    gpsAccuracyM = null;
    stopGpsRefine();
    gpsCapturing = true;
    try {
      // Phase 1: first fix ASAP (UI shows marker immediately).
      const first = await getBetterGpsFix({ minWaitMs: 0, maxWaitMs: 3500, desiredAccuracyM: 12, maximumAgeMs: 1500 });
      if (!first) {
        error = 'GPS nicht verfügbar oder abgelehnt.';
        return;
      }
      acceptFixIfBetter(first);

      // Phase 2: refine in background (only accept better accuracy).
      gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          acceptFixIfBetter({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy
          });

          // If we're already very good, stop early.
          if (gpsAccuracyM !== null && gpsAccuracyM <= 6 && gpsRefineSeconds >= 4) stopGpsRefine();
        },
        () => {
          // Keep the current best fix; just stop refining.
          stopGpsRefine();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_REFINE_MS }
      );

      // Hard stop (diminishing returns; also battery/UX).
      gpsRefineStopTimer = window.setTimeout(() => stopGpsRefine(), GPS_REFINE_MS);
    } finally {
      if (gpsFirstFixPending) gpsCapturing = false;
    }
  }

  async function addPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    // Capture GPS at photo time; wait at least 1s for a better fix.
    // Fire-and-forget: we still accept the photo even if GPS fails.
    if (!gpsCapturing) {
      gpsCapturing = true;
      getBetterGpsFix({ minWaitMs: 3000, maxWaitMs: 6500, desiredAccuracyM: 10 })
        .then((fix) => {
          if (!fix) return;
          gpsMode = 'auto';
          latitude = fix.lat;
          longitude = fix.lng;
          gpsAccuracyM = fix.acc;
          gpsFirstFixPending = false;
        })
        .finally(() => {
          gpsCapturing = false;
        });
    }
    for (const file of Array.from(input.files)) {
      const preview = URL.createObjectURL(file);
      const { width, height } = await imageSize(preview);
      images.push({ file, preview, width, height });
    }
    input.value = '';
  }

  async function imageSize(url: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.src = url;
    });
  }

  function removeImage(idx: number) {
    URL.revokeObjectURL(images[idx].preview);
    images.splice(idx, 1);
  }

  function toggleLabel(l: TreeLabel) {
    if (labels.includes(l)) labels = labels.filter((x) => x !== l);
    else labels = [...labels, l];
  }

  function ageYearsToDate(years: number): string {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    return d.toISOString().slice(0, 10);
  }

  async function submit() {
    // Hard guard against double-taps (mobile) causing multiple creates.
    if (submitting) return;
    submitting = true;
    error = null;
    try {
      if (latitude === null || longitude === null) {
        await retakeGps(); // triggers permission prompt if needed
        if (latitude === null || longitude === null) {
          error = 'Koordinaten fehlen.';
          return;
        }
      }
      if (images.length === 0) {
        error = 'Bitte mindestens ein Foto hinzufügen.';
        return;
      }
      const planted =
        estPlantedAt ||
        (estPlantedAge && !isNaN(Number(estPlantedAge)) ? ageYearsToDate(Number(estPlantedAge)) : null);

      const body = {
        plotId: data.plot.id,
        latitude,
        longitude,
        gpsAccuracyM,
        treeTypeId,
        healthStatus,
        labels,
        estPlantedAt: planted,
        description: description.trim() || null,
        images: images.map((i) => ({
          contentType: i.file.type || 'image/jpeg',
          widthPx: i.width,
          heightPx: i.height
        }))
      };

      let result: { treeId: string; uploads: { index: number; url: string; contentType: string }[] };
      try {
        result = await createTree(body);
      } catch (e) {
        error = (e as { message?: string }).message ?? 'Speichern fehlgeschlagen.';
        return;
      }
      const { treeId, uploads } = result;
      for (const u of uploads) {
        if (!u.url) {
          error =
            'Keine Upload-URL vom Server (S3 presign fehlgeschlagen). Prüfe S3_* in .env und die Server-Logs.';
          return;
        }
        const img = images[u.index];
        const put = await fetch(u.url, {
          method: 'PUT',
          headers: { 'content-type': u.contentType },
          body: img.file
        });
        if (!put.ok) {
          error = `Foto-Upload fehlgeschlagen (HTTP ${put.status}). Bei Cloudflare R2: unter Bucket → Settings → CORS eine Regel mit AllowedMethods PUT (und für Downloads GET), AllowedHeaders inkl. Content-Type, und AllowedOrigins exakt dein App-Ursprung (z. B. http://localhost:3000) setzen. Siehe https://developers.cloudflare.com/r2/buckets/cors/`;
          return;
        }
      }
      // After creating, return to the overview so the user can continue capturing.
      await goto(`/`);
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    const map = mapRef?.instance();
    if (!map) return;

    if (!marker) {
      marker = new maplibregl.Marker({ color: '#0f4c2c', draggable: true })
        .setLngLat([11.5, 48.5])
        .addTo(map);

      marker.on('dragend', () => {
        const ll = marker!.getLngLat();
        setCoordsFromMarker(ll.lng, ll.lat);
      });
    }

    if (latitude !== null && longitude !== null) {
      marker.setLngLat([longitude, latitude]);
      // Auto mode: keep the current position centered (manual mode should not fight the user).
      if (gpsMode === 'auto') {
        // While capturing, acceptFixIfBetter drives the camera (and applies +4 zoom once).
        // When not capturing, still keep the dot centered without changing zoom.
        if (!gpsCapturing) map.flyTo({ center: [longitude, latitude], zoom: map.getZoom(), essential: true });
      }
    }
  });

  // Auto-start GPS once if the user arrived without coordinates.
  $effect(() => {
    if (gpsAutoStarted) return;
    if (!gpsFirstFixPending) return;
    if (gpsCapturing) return;
    gpsAutoStarted = true;
    retakeGps();
  });

  // Cleanup any active geolocation watch when navigating away.
  $effect(() => {
    return () => {
      if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
      if (gpsRefineStopTimer !== null) window.clearTimeout(gpsRefineStopTimer);
    };
  });
</script>

<div class="min-h-dvh bg-earth pb-14">
  <header class="sticky top-0 z-10 bg-earth/90 backdrop-blur-md backdrop-saturate-150">
    <div class="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
      <a
        href="/"
        class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-ink text-sm font-semibold no-underline hover:border-pine transition"
      >
        Abbrechen
      </a>
      <div class="flex-1 flex flex-col gap-[2px] text-center">
        <span class="eyebrow">Neu erfassen</span>
        <h1
          class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Baum erfassen
        </h1>
      </div>
      <button
        class="px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm shadow-duff transition hover:-translate-y-px hover:shadow-understory disabled:opacity-70 disabled:cursor-not-allowed"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        onclick={submit}
        disabled={submitting}
      >
        {submitting ? 'Speichern …' : 'Speichern'}
      </button>
    </div>
    <hr class="border-0 h-px bg-hairline" />
  </header>

  <main class="max-w-2xl mx-auto px-4 pt-5 flex flex-col gap-4">
    {#if error}
      <div class="alert alert-error text-sm">{error}</div>
    {/if}

    <!-- GPS -->
    <section class="paper px-5 py-5 flex flex-col gap-3">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1">
          <h2
            class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral mb-2"
            data-num="01"
            style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
          >
            Position
          </h2>
          {#if gpsCapturing && gpsFirstFixPending}
            <div class="inline-flex items-center gap-2 px-3 py-2 rounded-btn border bg-earth text-sm font-semibold text-content-muted">
              <span class="spinner" aria-hidden="true"></span>
              GPS wird ermittelt …
            </div>
          {:else if gpsRefining}
            <div class="inline-flex items-center gap-2 px-3 py-2 rounded-btn border bg-earth text-sm font-semibold text-content-muted">
              <span class="spinner" aria-hidden="true"></span>
              Standort wird verbessert
            </div>
          {/if}
          {#if latitude !== null && longitude !== null}
            <div class="inline-flex items-center gap-2 px-3 py-2 rounded-btn border border-dashed bg-earth font-mono text-[0.8125rem] text-content">
              <MapPin size="0.875em" weight="bold" />
              <span>{latitude.toFixed(6)}</span>
              <span class="text-content-faint">·</span>
              <span>{longitude.toFixed(6)}</span>
            </div>
            <p class="text-xs text-content-muted mt-2">
              Genauigkeit:
              {#if gpsAccuracyM === null}
                {gpsMode === 'manual' ? 'unbekannt (manuell gesetzt)' : 'wird ermittelt'}
              {:else}
                ±{gpsAccuracyM.toFixed(1)} m
              {/if}
            </p>
          {:else}
            <p class="text-sm text-content-muted">Keine Koordinaten.</p>
          {/if}
        </div>
        <button
          class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-earth border text-ink text-sm font-semibold hover:border-pine transition"
          onclick={retakeGps}
        >
          <Crosshair size="1em" /> Erneut
        </button>
      </div>

      <div class="rounded-btn overflow-hidden border bg-surface-muted h-[220px] w-full">
        <Map
          bind:this={mapRef}
          initialCenter={[longitude ?? 11.5, latitude ?? 48.5]}
          initialZoom={latitude !== null && longitude !== null ? 17 : 7}
          class=""
          onClick={({ lng, lat }) => setCoordsFromMarker(lng, lat)}
        />
      </div>
      <p class="text-xs text-content-muted">
        Marker ziehen oder tippen, um die Position manuell zu setzen.
      </p>
    </section>

    <!-- Photos -->
    <section class="paper px-5 py-5 flex flex-col gap-3">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="02"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Fotos
      </h2>

      <div class="grid grid-cols-3 gap-2">
        {#each images as img, i}
          <div class="relative aspect-square rounded-btn overflow-hidden bg-surface-muted border">
            <img src={img.preview} alt="Baum-Foto {i + 1}" class="object-cover w-full h-full" />
            <button
              class="absolute top-1 right-1 w-8 h-8 min-h-0 min-w-0 grid place-items-center rounded-full text-earth border-0"
              style="background: var(--color-crimson);"
              onclick={() => removeImage(i)}
              aria-label="Entfernen"
            >
              <Trash size="0.9em" />
            </button>
            {#if i === 0}
              <span class="absolute bottom-1 left-1 chip-ember">Cover</span>
            {/if}
          </div>
        {/each}
        <button
          type="button"
          class="aspect-square rounded-btn border-2 border-dashed border-hairline grid place-items-center cursor-pointer text-content-muted hover:text-pine hover:border-pine hover:bg-surface-muted transition"
          onclick={() => cameraInputEl?.click()}
          aria-label="Foto aufnehmen"
        >
          <div class="flex flex-col items-center gap-1">
            <Camera size="1.5em" weight="duotone" />
            <Plus size="1em" />
          </div>
        </button>
        <input
          bind:this={cameraInputEl}
          type="file"
          accept="image/*"
          capture="environment"
          class="sr-only"
          onchange={addPhoto}
        />
      </div>
      <p class="text-xs text-content-muted">Das erste Foto dient als Cover.</p>
    </section>

    <!-- Classification -->
    <section class="paper px-5 py-5 flex flex-col gap-5">
      <h2
        class="font-serif font-medium text-[1.0625rem] tracking-tight text-ink m-0 section-numeral"
        data-num="03"
        style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
      >
        Klassifizierung
      </h2>

      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Baumart</span>
        <select
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          bind:value={treeTypeId}
        >
          {#each TREE_TYPES as t}
            <option value={t}>{TREE_TYPE_LABELS[t]}</option>
          {/each}
        </select>
      </label>

      <div class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Gesundheit</span>
        <div class="flex flex-wrap gap-2">
          {#each HEALTH_STATUSES as h}
            <button
              type="button"
              class="toggle-chip {healthStatus === h ? 'is-on' : ''}"
              aria-pressed={healthStatus === h}
              onclick={() => (healthStatus = h)}
            >
              <span
                class="w-2 h-2 rounded-full"
                style="background: var(--health-{h});"
              ></span>
              {HEALTH_LABELS[h]}
            </button>
          {/each}
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Aufgaben</span>
        <div class="flex flex-wrap gap-2">
          {#each TREE_LABELS as l}
            <button
              type="button"
              class="toggle-chip {labels.includes(l) ? 'is-on' : ''}"
              aria-pressed={labels.includes(l)}
              onclick={() => toggleLabel(l)}
            >
              {TREE_LABEL_LABELS[l]}
            </button>
          {/each}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="flex flex-col gap-2">
          <span class="text-[0.8125rem] font-semibold text-content">Pflanzjahr</span>
          <input
            type="date"
            class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
            bind:value={() => estPlantedAt, setPlantedAt}
          />
        </label>
        <label class="flex flex-col gap-2">
          <span class="text-[0.8125rem] font-semibold text-content">oder Alter (Jahre)</span>
          <input
            type="number"
            min="0"
            class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
            bind:value={() => estPlantedAge, setPlantedAge}
          />
        </label>
      </div>

      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Notiz</span>
        <textarea
          class="w-full px-4 py-3 min-h-[96px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          rows="3"
          bind:value={description}
          placeholder="Auffälligkeiten, Kontext, freie Notiz"
        ></textarea>
      </label>
    </section>
  </main>
</div>

<style>
  .spinner {
    width: 1em;
    height: 1em;
    border-radius: 999px;
    border: 2px solid color-mix(in oklab, var(--color-ink) 18%, transparent);
    border-top-color: color-mix(in oklab, var(--color-pine) 80%, transparent);
    animation: spin 800ms linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
