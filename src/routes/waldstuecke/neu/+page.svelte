<script lang="ts">
  // §5.3 Waldstück creation — hybrid interaction model.
  //
  // The map shows the DOP satellite + ALKIS-Parzellarkarte overlay (labels
  // and parcel outlines baked into raster tiles), so the user can see every
  // Flurstück and its Flurstücksnummer without any credentials.
  //
  // Interaction is two-pronged:
  //   1. **Tap to select**: when the LDBV WFS is configured, `parcelsInBbox`
  //      populates a vector overlay and tapping a polygon toggles selection.
  //      This is the preferred flow per the README.
  //   2. **Zeichnen (fallback)**: the ALKIS-Parzellarkarte is raster-only —
  //      no click targets — so when the WFS isn't reachable (no LDBV account)
  //      the user traces a polygon over the visible outlines. Drawn polygons
  //      are treated like any other selection and persisted as `parcels` rows
  //      with a synthetic `manual:<uuid>` cadastral_id.

  import { goto } from '$app/navigation';
  import Map from '$lib/components/Map.svelte';
  import { Trash, PencilSimple, X, Check } from 'phosphor-svelte';
  import maplibregl from 'maplibre-gl';
  import { parcelsInBbox } from './cadastral.remote';

  type ManualParcel = {
    id: string; // client-side handle, prefixed "manual:"
    geometry: GeoJSON.Polygon;
  };

  type AlkisParcel = {
    cadastralId: string;
    gemarkung: string | null;
    areaSqm: number | null;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
  };

  let mapRef = $state<Map | undefined>();
  let name = $state('');
  let submitting = $state(false);
  let error = $state<string | null>(null);

  // WFS-backed parcel cache for tap-select. Keyed by cadastralId.
  let featureCache = $state<Record<string, AlkisParcel>>({});
  let selection = $state<Record<string, true>>({});

  // Drawing mode state.
  let wfsAvailable = $state<null | boolean>(null); // null = untested
  let drawingMode = $state(false);
  let draftPoints = $state<GeoJSON.Position[]>([]);
  let manualParcels = $state<ManualParcel[]>([]);

  const selectionCount = $derived(
    Object.keys(selection).length + manualParcels.length
  );

  let mlMap: maplibregl.Map | null = null;
  let layersReady = false;
  let fetchTimer: ReturnType<typeof setTimeout> | null = null;

  const MIN_FETCH_ZOOM = 15;

  // --- Map layers -----------------------------------------------------------

  function ensureLayers(m: maplibregl.Map) {
    if (layersReady) return;

    // WFS parcel layer (tap-to-select). Stays empty when the WFS is down.
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

    // Manual-drawn parcels (solid fill, always "selected").
    m.addSource('manual', { type: 'geojson', data: empty() });
    m.addLayer({
      id: 'manual-fill',
      type: 'fill',
      source: 'manual',
      paint: { 'fill-color': '#5d7a4a', 'fill-opacity': 0.45 }
    });
    m.addLayer({
      id: 'manual-stroke',
      type: 'line',
      source: 'manual',
      paint: { 'line-color': '#1f3d2c', 'line-width': 2.5 }
    });

    // Draft polyline while the user is adding points.
    m.addSource('draft', { type: 'geojson', data: empty() });
    m.addLayer({
      id: 'draft-line',
      type: 'line',
      source: 'draft',
      paint: { 'line-color': '#c76a2b', 'line-width': 2, 'line-dasharray': [2, 2] }
    });
    m.addLayer({
      id: 'draft-points',
      type: 'circle',
      source: 'draft',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 5,
        'circle-color': '#c76a2b',
        'circle-stroke-color': '#f5f1e6',
        'circle-stroke-width': 2
      }
    });

    m.on('click', 'alkis-fill', (e) => {
      if (drawingMode) return; // tapping adds vertex, not toggles
      const f = e.features?.[0];
      const cid = f?.properties?.cadastralId as string | undefined;
      if (!cid) return;
      if (selection[cid]) delete selection[cid];
      else selection[cid] = true;
      renderAlkis();
    });
    m.on('mouseenter', 'alkis-fill', () => {
      if (!drawingMode) m.getCanvas().style.cursor = 'pointer';
    });
    m.on('mouseleave', 'alkis-fill', () => {
      m.getCanvas().style.cursor = '';
    });

    // Generic map click — used for drawing vertices.
    m.on('click', (e) => {
      if (!drawingMode) return;
      // Ignore clicks on the alkis-fill layer if we somehow got here
      draftPoints.push([e.lngLat.lng, e.lngLat.lat]);
      renderDraft();
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

  function renderManual() {
    if (!mlMap || !layersReady) return;
    const src = mlMap.getSource('manual') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: manualParcels.map((p) => ({
        type: 'Feature',
        geometry: p.geometry,
        properties: { id: p.id }
      }))
    });
  }

  function renderDraft() {
    if (!mlMap || !layersReady) return;
    const src = mlMap.getSource('draft') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (draftPoints.length === 0) {
      src.setData(empty());
      return;
    }
    const features: GeoJSON.Feature[] = draftPoints.map((p, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: p },
      properties: { index: i }
    }));
    if (draftPoints.length >= 2) {
      features.unshift({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: draftPoints },
        properties: {}
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }

  // --- WFS fetch (best-effort) ---------------------------------------------

  async function fetchViewport() {
    if (!mlMap) return;
    if (wfsAvailable === false) return; // tried once, gave up
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
      wfsAvailable = true;
      for (const f of res.features) {
        featureCache[f.cadastralId] = {
          cadastralId: f.cadastralId,
          gemarkung: f.gemarkung,
          areaSqm: f.areaSqm,
          geometry: f.geometry
        };
      }
      renderAlkis();
    } catch {
      // First failure flips us into draw-only mode. We deliberately don't
      // surface the WFS error — the user already sees the Parzellarkarte
      // overlay and just needs the drawing tool.
      wfsAvailable = false;
    }
  }

  function scheduleFetch() {
    if (fetchTimer) clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchViewport, 250);
  }

  // --- Drawing actions ------------------------------------------------------

  function enterDrawingMode() {
    drawingMode = true;
    draftPoints = [];
    error = null;
    if (mlMap) mlMap.getCanvas().style.cursor = 'crosshair';
  }

  function exitDrawingMode() {
    drawingMode = false;
    draftPoints = [];
    renderDraft();
    if (mlMap) mlMap.getCanvas().style.cursor = '';
  }

  function undoPoint() {
    draftPoints.pop();
    renderDraft();
  }

  function finishPolygon() {
    if (draftPoints.length < 3) {
      error = 'Bitte mindestens drei Punkte setzen.';
      return;
    }
    const ring = [...draftPoints, draftPoints[0]];
    const id = `manual:${crypto.randomUUID()}`;
    manualParcels.push({ id, geometry: { type: 'Polygon', coordinates: [ring] } });
    draftPoints = [];
    renderManual();
    renderDraft();
  }

  function removeManual(id: string) {
    const idx = manualParcels.findIndex((p) => p.id === id);
    if (idx >= 0) manualParcels.splice(idx, 1);
    renderManual();
  }

  function removeSelected(cid: string) {
    delete selection[cid];
    renderAlkis();
  }

  // --- Save -----------------------------------------------------------------

  async function save() {
    error = null;
    if (selectionCount === 0) {
      error = 'Bitte mindestens ein Flurstück auswählen oder zeichnen.';
      return;
    }
    submitting = true;
    try {
      const payload = {
        name: name.trim(),
        cadastralIds: Object.keys(selection),
        manualParcels: manualParcels.map((p) => ({ geometry: p.geometry }))
      };
      const fd = new FormData();
      fd.set('payload', JSON.stringify(payload));
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
    <Map bind:this={mapRef} initialCenter={[12.9164, 48.2600]} initialZoom={17} />

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
        {#if drawingMode}
          <div class="flex gap-2">
            <button
              class="inline-flex items-center gap-1 px-3 py-2 min-h-[36px] rounded-pill bg-earth border text-content text-[0.8125rem] font-semibold hover:border-pine hover:text-ink transition"
              onclick={undoPoint}
              disabled={draftPoints.length === 0}
            >
              Letzter Punkt
            </button>
            <button
              class="inline-flex items-center gap-1 px-3 py-2 min-h-[36px] rounded-pill bg-earth border text-content text-[0.8125rem] font-semibold hover:border-pine hover:text-ink transition"
              onclick={exitDrawingMode}
            >
              <X size="0.9em" /> Abbrechen
            </button>
            <button
              class="inline-flex items-center gap-1 px-3 py-2 min-h-[36px] rounded-pill text-earth border text-[0.8125rem] font-semibold transition hover:-translate-y-px disabled:opacity-60"
              style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
              onclick={finishPolygon}
              disabled={draftPoints.length < 3}
            >
              <Check size="0.9em" /> Schließen
            </button>
          </div>
        {:else}
          <button
            class="inline-flex items-center gap-2 px-3 py-2 min-h-[36px] rounded-pill bg-earth border text-content text-[0.8125rem] font-semibold hover:border-pine hover:text-ink transition"
            onclick={enterDrawingMode}
          >
            <PencilSimple size="1em" /> Flurstück zeichnen
          </button>
        {/if}
      </div>

      {#if drawingMode}
        <p class="text-xs text-content-muted">
          Tippe an jede Ecke des Flurstücks entlang der Umrisse auf der Karte. Mindestens 3 Punkte, dann „Schließen".
        </p>
      {:else if wfsAvailable === false}
        <p class="text-xs text-content-muted">
          Direktauswahl per Tipp benötigt einen LDBV-ALKIS-Zugang. Zeichne stattdessen die Umrisse entlang der sichtbaren Parzellarkarte.
        </p>
      {:else if wfsAvailable === true}
        <p class="text-xs text-content-muted">
          Tippe ein Flurstück an, um es auszuwählen — oder zeichne eigene Umrisse.
        </p>
      {/if}

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
          {#each manualParcels as p, i (p.id)}
            <li class="flex items-center justify-between gap-2 bg-earth border px-3 py-2 rounded-btn">
              <div class="flex flex-col gap-[2px]">
                <span class="mono text-sm text-content">Gezeichnet #{i + 1}</span>
                <span class="text-xs text-content-muted">manuell erfasst</span>
              </div>
              <button
                class="w-8 h-8 min-h-0 grid place-items-center rounded-full text-content-muted hover:text-crimson hover:bg-surface-muted transition"
                onclick={() => removeManual(p.id)}
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
