<script lang="ts">
  // §5.3 Waldstück creation: tap-to-select BayernAtlas Flurstücke.
  //
  // The map shows satellite imagery with a live overlay of ALKIS Flurstücke
  // for the current viewport — we debounce moveend, call the `parcelsInBbox`
  // remote function, and the server hits the BayernAtlas WFS (cached in DB).
  // Tapping a parcel toggles selection; a sticky bottom bar shows the count.

  import { goto } from '$app/navigation';
  import Map from '$lib/components/Map.svelte';
  import { Trash } from 'phosphor-svelte';
  import maplibregl from 'maplibre-gl';
  import { parcelsInBbox } from './cadastral.remote';

  let mapRef = $state<Map | undefined>();
  let name = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let loadingParcels = $state(false);

  // cadastralId → feature. Accumulates across viewport moves so previously
  // loaded parcels stay visible when the user pans back.
  let featureCache = $state<Record<string, {
    cadastralId: string;
    gemarkung: string | null;
    areaSqm: number | null;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  }>>({});

  // Selection set — record keyed by cadastralId for reactive membership tests.
  let selection = $state<Record<string, true>>({});
  const selectionCount = $derived(Object.keys(selection).length);

  let mlMap: maplibregl.Map | null = null;
  let layersReady = false;
  let fetchTimer: ReturnType<typeof setTimeout> | null = null;

  const MIN_FETCH_ZOOM = 15;

  function ensureLayers(m: maplibregl.Map) {
    if (layersReady) return;
    m.addSource('alkis', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    m.addLayer({
      id: 'alkis-fill',
      type: 'fill',
      source: 'alkis',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'selected'], true],
          '#5d7a4a',
          '#f5f1e6'
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'selected'], true],
          0.55,
          0.08
        ]
      }
    });
    m.addLayer({
      id: 'alkis-stroke',
      type: 'line',
      source: 'alkis',
      paint: {
        'line-color': [
          'case',
          ['==', ['get', 'selected'], true],
          '#1f3d2c',
          '#f5f1e6'
        ],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], true],
          2.5,
          1
        ]
      }
    });
    m.addLayer({
      id: 'alkis-labels',
      type: 'symbol',
      source: 'alkis',
      minzoom: 16,
      layout: {
        'text-field': ['get', 'cadastralId'],
        'text-size': 11,
        'text-allow-overlap': false
      },
      paint: {
        'text-color': '#1f3d2c',
        'text-halo-color': '#f5f1e6',
        'text-halo-width': 1.5
      }
    });

    m.on('click', 'alkis-fill', (e) => {
      const f = e.features?.[0];
      const cid = f?.properties?.cadastralId as string | undefined;
      if (!cid) return;
      if (selection[cid]) delete selection[cid];
      else selection[cid] = true;
      renderSource();
    });
    m.on('mouseenter', 'alkis-fill', () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'alkis-fill', () => {
      m.getCanvas().style.cursor = '';
    });

    layersReady = true;
  }

  function renderSource() {
    if (!mlMap || !layersReady) return;
    const src = mlMap.getSource('alkis') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const features: GeoJSON.Feature[] = Object.values(featureCache).map((f) => ({
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        cadastralId: f.cadastralId,
        selected: !!selection[f.cadastralId]
      }
    }));
    src.setData({ type: 'FeatureCollection', features });
  }

  async function fetchViewport() {
    if (!mlMap) return;
    if (mlMap.getZoom() < MIN_FETCH_ZOOM) return;
    const b = mlMap.getBounds();
    const bbox: [number, number, number, number] = [
      b.getWest(),
      b.getSouth(),
      b.getEast(),
      b.getNorth()
    ];
    loadingParcels = true;
    error = null;
    try {
      const res = await parcelsInBbox({ bbox }).run();
      for (const f of res.features) {
        featureCache[f.cadastralId] = {
          cadastralId: f.cadastralId,
          gemarkung: f.gemarkung,
          areaSqm: f.areaSqm,
          geometry: f.geometry
        };
      }
      renderSource();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Flurstücke konnten nicht geladen werden.';
    } finally {
      loadingParcels = false;
    }
  }

  function scheduleFetch() {
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchViewport, 250);
  }

  function removeSelected(cid: string) {
    delete selection[cid];
    renderSource();
  }

  async function save() {
    error = null;
    if (selectionCount === 0) {
      error = 'Bitte mindestens ein Flurstück auswählen.';
      return;
    }
    submitting = true;
    try {
      const fd = new FormData();
      fd.set(
        'payload',
        JSON.stringify({ name: name.trim(), cadastralIds: Object.keys(selection) })
      );
      const res = await fetch('', { method: 'POST', body: fd });
      if (res.redirected) {
        await goto(res.url);
        return;
      }
      const body = await res.json().catch(() => ({}));
      error = body.error ?? 'Speichern fehlgeschlagen.';
    } finally {
      submitting = false;
    }
  }

  $effect(() => {
    if (!mapRef) return;
    const m = mapRef.instance();
    if (!m) return;
    mlMap = m;
    const init = () => {
      ensureLayers(m);
      m.on('moveend', scheduleFetch);
      m.on('zoomend', scheduleFetch);
      scheduleFetch();
    };
    if (m.loaded()) init();
    else m.once('load', init);
    return () => {
      m.off('moveend', scheduleFetch);
      m.off('zoomend', scheduleFetch);
    };
  });
</script>

<div class="home-shell">
  <header class="bg-surface/85 backdrop-blur-md backdrop-saturate-150 border-b">
    <div class="flex items-center gap-3 px-4 py-2">
      <a
        href="/"
        class="inline-flex items-center gap-2 px-3 py-2 min-h-[40px] rounded-btn bg-surface border text-ink text-sm font-semibold no-underline hover:border-pine transition"
      >
        Abbrechen
      </a>
      <div class="flex-1 flex flex-col gap-[2px] text-center">
        <span class="eyebrow">Neu anlegen</span>
        <h1
          class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
          style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
        >
          Neues Waldstück
        </h1>
      </div>
      <button
        class="px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm shadow-duff transition hover:-translate-y-px hover:shadow-understory disabled:opacity-70 disabled:cursor-not-allowed"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        onclick={save}
        disabled={submitting || selectionCount === 0}
      >
        Speichern
      </button>
    </div>
  </header>

  <div class="relative">
    <Map bind:this={mapRef} initialZoom={16} />

    <div class="sheet p-5 pt-6 flex flex-col gap-4">
      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Name (optional)</span>
        <input
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          bind:value={name}
          placeholder="z. B. Wald am Hang"
        />
      </label>

      <div class="flex items-center justify-between gap-3">
        <div class="flex items-baseline gap-2">
          <span class="eyebrow">Flurstücke</span>
          <span class="numeral text-2xl leading-none text-ink">{selectionCount}</span>
        </div>
        {#if loadingParcels}
          <span class="text-xs text-content-muted">Flurstücke werden geladen…</span>
        {:else}
          <p class="text-xs text-content-muted">
            Tippe ein Flurstück an, um es auszuwählen. Näher heranzoomen, um die Umrisse zu sehen.
          </p>
        {/if}
      </div>

      {#if error}
        <div class="alert alert-error text-sm">{error}</div>
      {/if}

      {#if selectionCount > 0}
        <ul class="flex flex-col gap-1 max-h-40 overflow-auto">
          {#each Object.keys(selection) as cid (cid)}
            <li class="flex items-center justify-between gap-2 bg-earth border px-3 py-2 rounded-btn">
              <div class="flex flex-col gap-[2px]">
                <span class="mono text-sm text-content">{cid}</span>
                {#if featureCache[cid]?.gemarkung}
                  <span class="text-xs text-content-muted">{featureCache[cid].gemarkung}</span>
                {/if}
              </div>
              <button
                class="w-8 h-8 min-h-0 grid place-items-center rounded-full text-content-muted hover:text-crimson hover:bg-surface-muted transition"
                onclick={() => removeSelected(cid)}
                aria-label="Entfernen"
              >
                <Trash size="1em" />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</div>
