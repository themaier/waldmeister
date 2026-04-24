<script lang="ts">
  // §5.3 Waldstück creation — tap-to-select Flurstücke.
  //
  // The map shows the DOP satellite + ALKIS-Parzellarkarte overlay (labels
  // and parcel outlines baked into raster tiles). `parcelsInBbox` populates
  // a vector overlay on top; tapping a polygon toggles selection.

  import Map from '$lib/components/Map.svelte';
  import { Trash } from 'phosphor-svelte';
  import maplibregl from 'maplibre-gl';
  import { parcelsInBbox } from './cadastral.remote';
  import { createPlot } from './create.remote';

  type AlkisParcel = {
    cadastralId: string;
    gemarkung: string | null;
    areaSqm: number | null;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  };

  let mapRef = $state<Map | undefined>();

  // WFS-backed parcel cache for tap-select. Keyed by cadastralId.
  let featureCache = $state<Record<string, AlkisParcel>>({});
  let selection = $state<Record<string, true>>({});

  const selectedIds = $derived(Object.keys(selection));
  const selectionCount = $derived(selectedIds.length);

  let mlMap: maplibregl.Map | null = null;
  let layersReady = false;
  let fetchTimer: ReturnType<typeof setTimeout> | null = null;
  let loadError = $state<string | null>(null);

  const MIN_FETCH_ZOOM = 15;

  // --- Map layers -----------------------------------------------------------

  function ensureLayers(m: maplibregl.Map) {
    if (layersReady) return;

    m.addSource('alkis', { type: 'geojson', data: empty() });
    m.addLayer({
      id: 'alkis-fill',
      type: 'fill',
      source: 'alkis',
      paint: {
        'fill-color': [
          'case',
          ['==', ['get', 'selected'], true],
          '#5d7a4a',
          '#c76a2b'
        ],
        'fill-opacity': [
          'case',
          ['==', ['get', 'selected'], true],
          0.55,
          0.25
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
          '#c76a2b'
        ],
        'line-width': [
          'case',
          ['==', ['get', 'selected'], true],
          2.5,
          2
        ]
      }
    });

    m.on('click', 'alkis-fill', (e) => {
      const f = e.features?.[0];
      const cid = f?.properties?.cadastralId as string | undefined;
      if (!cid) return;
      if (selection[cid]) delete selection[cid];
      else selection[cid] = true;
      renderAlkis();
    });
    m.on('mouseenter', 'alkis-fill', () => {
      m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'alkis-fill', () => {
      m.getCanvas().style.cursor = '';
    });

    layersReady = true;
  }

  const empty = (): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features: [] });

  function renderAlkis() {
    if (!mlMap || !layersReady) return;
    const src = mlMap.getSource('alkis') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: Object.values(featureCache).map((f) => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          cadastralId: f.cadastralId,
          selected: !!selection[f.cadastralId]
        }
      }))
    });
  }

  // --- WFS fetch ------------------------------------------------------------

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
      renderAlkis();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Flurstücke konnten nicht geladen werden.';
    }
  }

  function scheduleFetch() {
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchViewport, 250);
  }

  function removeSelected(cid: string) {
    delete selection[cid];
    renderAlkis();
  }

  // --- Lifecycle ------------------------------------------------------------

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

<form {...createPlot} class="home-shell">
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
        type="submit"
        class="px-4 py-2 min-h-[40px] rounded-btn text-earth border font-semibold text-sm shadow-duff transition hover:-translate-y-px hover:shadow-understory disabled:opacity-70 disabled:cursor-not-allowed"
        style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
        disabled={!!createPlot.pending || selectionCount === 0}
      >
        Speichern
      </button>
    </div>
  </header>

  <div class="relative">
    <Map bind:this={mapRef} initialCenter={[12.9164, 48.2600]} initialZoom={17} />

    <div class="sheet p-5 pt-6 flex flex-col gap-4">
      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content">Name (optional)</span>
        <input
          {...createPlot.fields.name.as('text')}
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          placeholder="z. B. Wald am Hang"
        />
      </label>

      <div class="flex items-baseline gap-2">
        <span class="eyebrow">Flurstücke</span>
        <span class="numeral text-2xl leading-none text-ink">{selectionCount}</span>
      </div>

      <p class="text-xs text-content-muted">
        Tippe ein Flurstück an, um es auszuwählen.
      </p>

      {#each createPlot.fields.allIssues() as issue}
        <div class="alert alert-error text-sm">{issue.message}</div>
      {/each}

      {#if loadError}
        <div class="alert alert-error text-sm">{loadError}</div>
      {/if}

      {#each selectedIds as cid, i (cid)}
        <input {...createPlot.fields.cadastralIds[i].as('hidden', cid)} />
      {/each}

      {#if selectionCount > 0}
        <ul class="flex flex-col gap-1 max-h-40 overflow-auto">
          {#each selectedIds as cid (cid)}
            <li class="flex items-center justify-between gap-2 bg-earth border px-3 py-2 rounded-btn">
              <div class="flex flex-col gap-[2px]">
                <span class="mono text-sm text-content">{cid}</span>
                {#if featureCache[cid]?.gemarkung}
                  <span class="text-xs text-content-muted">{featureCache[cid].gemarkung}</span>
                {/if}
              </div>
              <button
                type="button"
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
</form>
