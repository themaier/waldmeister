<script lang="ts">
  // §5.3 Waldstück creation — tap-to-select Flurstücke.
  //
  // The map shows the DOP satellite + ALKIS-Parzellarkarte overlay (labels
  // and parcel outlines baked into raster tiles). `parcelsInBbox` populates
  // a vector overlay on top; tapping a polygon toggles selection.

  import Map from "$lib/components/Map.svelte";
  import { Trash } from "phosphor-svelte";
  import maplibregl from "maplibre-gl";
  import { onMount } from "svelte";
  import { parcelsInBbox, traceParcelAt } from "./cadastral.remote";
  import { createPlot } from "./create.remote";

  type AlkisParcel = {
    cadastralId: string;
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    takenBy: { plotId: string; plotName: string | null } | null;
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
  let tracing = $state(false);

  const MIN_FETCH_ZOOM = 15;
  // Below this zoom the raster tiles don't show the parcel outlines clearly
  // enough for tracing, and the 7×7 window would cover a huge area.
  const MIN_TRACE_ZOOM = 16;

  // --- Map layers -----------------------------------------------------------

  function ensureLayers(m: maplibregl.Map) {
    if (layersReady) return;

    m.addSource("alkis", { type: "geojson", data: empty() });
    // Fill is always present (transparent when unselected) so that
    // queryRenderedFeatures can hit-test cached parcels on tap.
    m.addLayer({
      id: "alkis-fill",
      type: "fill",
      source: "alkis",
      paint: {
        "fill-color": "#dc2626",
        "fill-opacity": ["case", ["==", ["get", "selected"], true], 0.5, 0],
      },
    });
    m.addLayer({
      id: "alkis-stroke",
      type: "line",
      source: "alkis",
      paint: {
        "line-color": "#dc2626",
        "line-width": 3,
        "line-opacity": ["case", ["==", ["get", "selected"], true], 1, 0],
      },
    });

    m.on("mouseenter", "alkis-fill", (e) => {
      const cid = e.features?.[0]?.properties?.cadastralId as
        | string
        | undefined;
      const taken = cid ? !!featureCache[cid]?.takenBy : false;
      m.getCanvas().style.cursor = taken ? "not-allowed" : "pointer";
    });
    m.on("mouseleave", "alkis-fill", () => {
      m.getCanvas().style.cursor = "";
    });

    layersReady = true;
  }

  const empty = (): GeoJSON.FeatureCollection => ({
    type: "FeatureCollection",
    features: [],
  });

  function renderAlkis() {
    if (!mlMap || !layersReady) return;
    const src = mlMap.getSource("alkis") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    src.setData({
      type: "FeatureCollection",
      features: Object.values(featureCache).map((f) => ({
        type: "Feature",
        geometry: f.geometry,
        properties: {
          cadastralId: f.cadastralId,
          selected: !!selection[f.cadastralId],
          taken: !!f.takenBy,
        },
      })),
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
      b.getNorth(),
    ];
    try {
      const res = await parcelsInBbox({ bbox }).run();
      for (const f of res.features) {
        featureCache[f.cadastralId] = {
          cadastralId: f.cadastralId,
          geometry: f.geometry,
          takenBy: f.takenBy,
        };
        if (f.takenBy && selection[f.cadastralId]) {
          delete selection[f.cadastralId];
        }
      }
      renderAlkis();
    } catch (e) {
      loadError =
        e instanceof Error ?
          e.message
        : "Flurstücke konnten nicht geladen werden.";
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

  // --- Click routing -------------------------------------------------------
  // A click on an existing parcel toggles its selection; a click on empty
  // terrain triggers a server-side trace of the parcel outline from the
  // Parzellarkarte raster tiles.
  async function handleMapClick(ev: { lng: number; lat: number }) {
    console.log(
      "[neu] handleMapClick",
      ev,
      "mlMap=",
      !!mlMap,
      "tracing=",
      tracing,
      "layersReady=",
      layersReady
    );
    if (!mlMap || tracing) return;
    const pt = mlMap.project([ev.lng, ev.lat]);
    const hits =
      layersReady ?
        mlMap.queryRenderedFeatures(pt, { layers: ["alkis-fill"] })
      : [];
    console.log(
      "[neu] hits=",
      hits.length,
      "zoom=",
      mlMap.getZoom(),
      "MIN_TRACE_ZOOM=",
      MIN_TRACE_ZOOM
    );
    if (hits.length > 0) {
      const cid = hits[0].properties?.cadastralId as string | undefined;
      if (!cid) return;
      if (featureCache[cid]?.takenBy) return;
      if (selection[cid]) delete selection[cid];
      else selection[cid] = true;
      renderAlkis();
      return;
    }

    if (mlMap.getZoom() < MIN_TRACE_ZOOM) {
      loadError = "Zum Erkennen der Parzelle bitte näher heranzoomen.";
      return;
    }

    loadError = null;
    tracing = true;
    try {
      console.log("[neu] -> traceParcelAt");
      const { cadastralId } = await traceParcelAt({ lng: ev.lng, lat: ev.lat });
      console.log("[neu] traced cid=", cadastralId);
      await fetchViewport();
      if (featureCache[cadastralId] && !featureCache[cadastralId].takenBy) {
        selection[cadastralId] = true;
      }
      renderAlkis();
    } catch (e) {
      console.error("[neu] traceParcelAt failed", e);
      loadError =
        e instanceof Error ?
          e.message
        : "Parzelle konnte nicht erkannt werden.";
    } finally {
      tracing = false;
    }
  }

  // --- Lifecycle ------------------------------------------------------------
  // Svelte mounts children before parents, so Map.svelte's internal MapLibre
  // instance is already created by the time this runs.

  onMount(() => {
    const m = mapRef?.instance();
    if (!m) return;
    mlMap = m;
    const init = () => {
      ensureLayers(m);
      m.on("moveend", scheduleFetch);
      m.on("zoomend", scheduleFetch);
      scheduleFetch();
    };
    if (m.loaded()) init();
    else m.once("load", init);
    return () => {
      m.off("moveend", scheduleFetch);
      m.off("zoomend", scheduleFetch);
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
    <Map
      bind:this={mapRef}
      initialCenter={[12.9164, 48.26]}
      initialZoom={17}
      onClick={handleMapClick}
    />

    {#if tracing}
      <div
        class="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 rounded-btn bg-surface/90 border text-sm text-content shadow-duff"
      >
        Parzelle wird erkannt …
      </div>
    {/if}

    <div class="sheet p-5 pt-6 flex flex-col gap-4">
      <label class="flex flex-col gap-2">
        <span class="text-[0.8125rem] font-semibold text-content"
          >Name (optional)</span
        >
        <input
          {...createPlot.fields.name.as("text")}
          class="w-full px-4 py-3 min-h-[48px] rounded-btn border bg-earth text-[0.9375rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
          placeholder="z. B. Wald am Hang"
        />
      </label>

      <div class="flex items-baseline gap-2">
        <span class="eyebrow">Flurstücke</span>
        <span class="numeral text-2xl leading-none text-ink"
          >{selectionCount}</span
        >
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
        <input {...createPlot.fields.cadastralIds[i].as("hidden", cid)} />
      {/each}

      {#if selectionCount > 0}
        <ul class="flex flex-col gap-1 max-h-40 overflow-auto">
          {#each selectedIds as cid (cid)}
            <li
              class="flex items-center justify-between gap-2 bg-earth border px-3 py-2 rounded-btn"
            >
              <span class="mono text-sm text-content">{cid}</span>
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
