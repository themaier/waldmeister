<script lang="ts">
  // §5.2 Home / Waldstück-Übersicht.
  // One persistent MapLibre instance; we switch "active" plot by flying the
  // camera rather than navigating routes.

  import { goto } from "$app/navigation";
  import Map from "$lib/components/Map.svelte";
  import PlotSwitcher from "$lib/components/PlotSwitcher.svelte";
  import OnboardingCard from "$lib/components/OnboardingCard.svelte";
  import RouteDrawTool from "$lib/components/RouteDrawTool.svelte";
  import { boundsOfPolygons, shouldFlyTo } from "$lib/geo";
  import {
    Plus,
    Crosshair,
    X,
    Gear,
    Tree,
    Calculator,
    Path,
  } from "phosphor-svelte";
  import type { PageData } from "./$types";
  import maplibregl from "maplibre-gl";
  import { getPlotOverview } from "./trees.remote";
  import { officialTreeDotsForPlot } from "./plots.remote";
  import { createRoute } from "./access-routes.remote";
  import type { RouteType } from "$lib/enums";

  let { data }: { data: PageData & { plots: any[]; parcels: any[] } } =
    $props();

  let mapRef = $state<Map | undefined>();
  // Manual selection wins while the plot still exists; otherwise we fall back
  // to the first plot from the load data so that activePlotId auto-heals when
  // the current plot is deleted or the data is invalidated.
  let manualPlotId = $state<string | null>(null);
  const activePlotId = $derived(
    manualPlotId && data.plots.some((p) => p.id === manualPlotId) ?
      manualPlotId
    : (data.plots[0]?.id ?? null)
  );
  let placementMode = $state(false);
  let tapToast = $state<{ targetPlotId: string } | null>(null);
  // Route-drawing state. `routeDrawType` non-null = the tool is mounted; the
  // segmented picker (§5.4 step 2) sets which type the form starts with.
  let routeTypePickerOpen = $state(false);
  let routeDrawType = $state<RouteType | null>(null);
  let treesForActive = $state<any[]>([]);
  let routesForActive = $state<any[]>([]);
  // Official Bayern Einzelbäume points are loaded on demand for the active
  // plot only (never the whole region). `officialTreeDots` is the cache for
  // the *currently active* plot — it gets cleared whenever the plot changes.
  let officialTreeDots = $state<any[]>([]);
  let officialTreesVisible = $state(false);
  let officialTreesLoading = $state(false);
  let treeCountLoading = $state(false);
  let treeCountResult = $state<number | null>(null);
  let treeActionError = $state<string | null>(null);
  let lastBounds = $state<[[number, number], [number, number]] | null>(null);

  const activePlot = $derived(data.plots.find((p) => p.id === activePlotId));
  // Record (plain object) rather than Set: Svelte's $state proxy doesn't wrap
  // Map/Set, so we keep owned-plot membership in a shape that's safe to share
  // with any $state consumer too.
  const ownedPlotIds = $derived<Record<string, true>>(
    Object.fromEntries(data.plots.map((p) => [p.id, true]))
  );

  // --- Render outlines + labels on the map ---
  // $state so reactive expressions (e.g. `{#if mlMap && ...}`) re-evaluate
  // once the map mounts and we capture its instance.
  let mlMap = $state<maplibregl.Map | null>(null);
  let layersInitialized = false;

  function ensureSources(map: maplibregl.Map) {
    if (map.getSource("parcels")) {
      layersInitialized = true;
      return;
    }

    map.addSource("parcels", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });

    map.addLayer({
      id: "parcels-fill",
      type: "fill",
      source: "parcels",
      paint: {
        "fill-color": [
          "case",
          ["==", ["get", "isActive"], true],
          "rgba(31,61,44,0.25)",
          ["==", ["get", "isOwned"], true],
          "rgba(31,61,44,0.1)",
          "rgba(255,255,255,0)",
        ],
      },
    });

    map.addLayer({
      id: "parcels-stroke",
      type: "line",
      source: "parcels",
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "isActive"], true],
          "#f97316",
          ["==", ["get", "isOwned"], true],
          "#5d7a4a",
          "rgba(255,255,255,0.55)",
        ],
        "line-width": [
          "case",
          ["==", ["get", "isActive"], true],
          4,
          ["==", ["get", "isOwned"], true],
          2,
          1,
        ],
      },
    });

    map.addLayer({
      id: "parcels-labels",
      type: "symbol",
      source: "parcels",
      minzoom: 14,
      layout: {
        "text-field": ["get", "cadastralId"],
        "text-size": ["case", ["==", ["get", "isOwned"], true], 14, 11],
        "text-allow-overlap": false,
      },
      paint: {
        "text-color": [
          "case",
          ["==", ["get", "isOwned"], true],
          "#1f3d2c",
          "#f5f1e6",
        ],
        "text-halo-color": [
          "case",
          ["==", ["get", "isOwned"], true],
          "#f5f1e6",
          "#132318",
        ],
        "text-halo-width": 1.5,
      },
    });

    // Trees layer
    map.addSource("trees", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "trees",
      type: "circle",
      source: "trees",
      paint: {
        "circle-radius": 7,
        "circle-color": [
          "match",
          ["get", "healthStatus"],
          "healthy",
          "#5d7a4a",
          "must-watch",
          "#d4a23c",
          "infected",
          "#c76a2b",
          "dead",
          "#4a4a4a",
          "#5d7a4a",
        ],
        "circle-stroke-color": "#f5f1e6",
        "circle-stroke-width": 2,
      },
    });

    // Official Einzelbäume points for the active Waldstück. We never load
    // the regional dataset wholesale — the source only ever holds the dots
    // that fall inside the currently-selected plot. Hidden until the user
    // toggles it on so we don't pay the fetch on every plot switch.
    map.addSource("official-trees", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "official-trees",
      type: "circle",
      source: "official-trees",
      layout: { visibility: "none" },
      paint: {
        "circle-radius": 3.5,
        "circle-color": "#d4a23c",
        "circle-opacity": 0.9,
        "circle-stroke-color": "#132318",
        "circle-stroke-width": 0.75,
      },
    });

    // Routes layer (Anfahrten + Rückegassen)
    // MapLibre does not support data expressions for line-dasharray, so split
    // into two layers sharing one source and filter by routeType.
    map.addSource("routes", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "routes-anfahrt",
      type: "line",
      source: "routes",
      filter: ["!=", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-width": [
          "case",
          [
            "all",
            ["==", ["get", "routeType"], "anfahrt"],
            ["==", ["get", "vehicleType"], "großgerät"],
          ],
          5,
          ["==", ["get", "routeType"], "anfahrt"],
          3,
          2,
        ],
      },
    });
    map.addLayer({
      id: "routes-rueckegasse",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-width": 4,
        "line-dasharray": [2, 2],
      },
    });

    layersInitialized = true;
  }

  function updateParcelFeatures() {
    if (!mlMap || !layersInitialized) return;
    const source = mlMap.getSource("parcels") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    const features = data.parcels.map((p) => ({
      type: "Feature" as const,
      id: p.id,
      geometry: p.geometry,
      properties: {
        parcelId: p.id,
        plotId: p.plotId,
        cadastralId: p.cadastralId,
        isOwned: !!ownedPlotIds[p.plotId],
        isActive: p.plotId === activePlotId,
      },
    }));
    source.setData({ type: "FeatureCollection", features });
  }

  function updateOfficialTreeFeatures() {
    if (!mlMap || !layersInitialized) return;
    const source = mlMap.getSource("official-trees") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: officialTreeDots.map((tree) => ({
        type: "Feature",
        id: tree.id,
        geometry: {
          type: "Point",
          coordinates: [Number(tree.longitude), Number(tree.latitude)],
        },
        properties: { heightM: tree.heightM },
      })),
    });
    mlMap.setLayoutProperty(
      "official-trees",
      "visibility",
      officialTreesVisible ? "visible" : "none"
    );
  }

  async function ensureDotsForActivePlot(): Promise<number> {
    if (!activePlotId) return 0;
    if (officialTreeDots.length > 0) return officialTreeDots.length;
    const result = await officialTreeDotsForPlot(activePlotId).run();
    officialTreeDots = result.dots;
    updateOfficialTreeFeatures();
    return officialTreeDots.length;
  }

  async function loadActivePlotLayers(plotId: string | null) {
    if (!plotId) {
      treesForActive = [];
      routesForActive = [];
    } else {
      try {
        const body = await getPlotOverview(plotId).run();
        treesForActive = body.trees;
        routesForActive = body.routes;
      } catch {
        /* non-fatal: leave layers empty on error */
      }
    }
    // Reset official-tree state on every plot switch — the cached dots
    // belong to the *previous* plot and must not leak across.
    officialTreeDots = [];
    officialTreesVisible = false;
    treeCountResult = null;
    treeActionError = null;
    if (!mlMap || !layersInitialized) return;
    (mlMap.getSource("trees") as maplibregl.GeoJSONSource | undefined)?.setData(
      {
        type: "FeatureCollection",
        features: treesForActive.map((t) => ({
          type: "Feature",
          id: t.id,
          geometry: {
            type: "Point",
            coordinates: [Number(t.longitude), Number(t.latitude)],
          },
          properties: {
            treeId: t.id,
            healthStatus: t.healthStatus,
            labels: t.labels,
          },
        })),
      }
    );
    (
      mlMap.getSource("routes") as maplibregl.GeoJSONSource | undefined
    )?.setData({
      type: "FeatureCollection",
      features: routesForActive.map((r) => ({
        type: "Feature",
        id: r.id,
        geometry: r.pathData,
        properties: {
          routeId: r.id,
          routeType: r.routeType,
          vehicleType: r.vehicleType,
        },
      })),
    });
    updateOfficialTreeFeatures();
  }

  async function toggleOfficialTrees() {
    if (!activePlotId || officialTreesLoading) return;
    treeActionError = null;
    if (officialTreesVisible) {
      officialTreesVisible = false;
      updateOfficialTreeFeatures();
      return;
    }
    officialTreesLoading = true;
    try {
      const count = await ensureDotsForActivePlot();
      officialTreesVisible = true;
      updateOfficialTreeFeatures();
      if (count === 0) {
        treeActionError =
          "Keine offiziellen Baum-Punkte für dieses Waldstück gefunden.";
      }
    } catch (e) {
      treeActionError =
        e instanceof Error ? e.message : "Baum-Overlay fehlgeschlagen.";
    } finally {
      officialTreesLoading = false;
    }
  }

  async function countOfficialTrees() {
    if (!activePlotId || treeCountLoading) return;
    treeCountLoading = true;
    treeActionError = null;
    try {
      treeCountResult = await ensureDotsForActivePlot();
    } catch (e) {
      treeActionError =
        e instanceof Error ? e.message : "Baumzählung fehlgeschlagen.";
    } finally {
      treeCountLoading = false;
    }
  }

  function fitToPlot(plotId: string) {
    if (!mapRef) return;
    const polys: GeoJSON.Polygon[] = data.parcels
      .filter((p) => p.plotId === plotId)
      .map((p) => p.geometry);
    const b = boundsOfPolygons(polys);
    if (!b) return;
    // Tight framing: ~6 % of the viewport on each side so the parcel "just
    // barely fits" — feels right on phones and still leaves room for the
    // floating action stack. We derive the target zoom from `cameraForBounds`
    // so a long-distance fly-to lands at the same framing as a local fit.
    const padding = Math.max(
      16,
      Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.06)
    );
    if (shouldFlyTo(lastBounds, b) && mlMap) {
      const cam = mlMap.cameraForBounds(b, { padding });
      if (cam?.center && cam.zoom != null) {
        const c = maplibregl.LngLat.convert(cam.center);
        mapRef.flyTo([c.lng, c.lat], Math.min(cam.zoom, 18));
      } else {
        mapRef.fitBounds(b, { padding });
      }
    } else {
      mapRef.fitBounds(b, { padding });
    }
    lastBounds = b;
  }

  async function switchTo(plotId: string) {
    if (placementMode || routeDrawType) {
      tapToast = { targetPlotId: plotId };
      return;
    }
    manualPlotId = plotId;
    updateParcelFeatures();
    await loadActivePlotLayers(plotId);
    fitToPlot(plotId);
  }

  function createPlot() {
    goto("/waldstuecke/neu");
  }

  function onMapClick(e: {
    lng: number;
    lat: number;
    originalEvent: MouseEvent;
  }) {
    // Route drawing owns the canvas — let the tool handle taps itself.
    if (routeDrawType) return;
    if (placementMode) {
      placementMode = false;
      goto(`/baeume/neu?plot=${activePlotId}&lat=${e.lat}&lng=${e.lng}`);
      return;
    }
    // Hit-test: did we click a parcel? MapLibre lets us query rendered features.
    if (!mlMap) return;
    const fs = mlMap.queryRenderedFeatures(
      [
        [e.originalEvent.clientX - 5, e.originalEvent.clientY - 5],
        [e.originalEvent.clientX + 5, e.originalEvent.clientY + 5],
      ],
      { layers: ["parcels-fill"] }
    );
    if (fs.length === 0) return;
    const feature = fs[0];
    const parcelPlotId = feature.properties?.plotId as string | undefined;
    if (!parcelPlotId) return;
    if (!ownedPlotIds[parcelPlotId]) {
      // Unowned parcel → inspector sheet (§5.2). Show a quick popup for now.
      new maplibregl.Popup({ closeButton: true })
        .setLngLat([e.lng, e.lat])
        .setHTML(
          `<div class="p-2">
             <p class="text-xs opacity-60 mb-1">Flurstück</p>
             <p class="text-2xl font-bold">${feature.properties?.cadastralId ?? ""}</p>
             <p class="text-sm opacity-70 mt-2">Nicht in deinem Besitz.</p>
           </div>`
        )
        .addTo(mlMap);
      return;
    }
    if (parcelPlotId !== activePlotId) switchTo(parcelPlotId);
  }

  function onLongPress(e: { lng: number; lat: number }) {
    if (!activePlotId) return;
    if (routeDrawType) return; // tool owns gestures
    goto(`/baeume/neu?plot=${activePlotId}&lat=${e.lat}&lng=${e.lng}`);
  }

  function startPlacement() {
    placementMode = true;
  }
  function cancelPlacement() {
    placementMode = false;
  }

  function startRouteDraw(type: RouteType) {
    routeTypePickerOpen = false;
    placementMode = false;
    routeDrawType = type;
  }
  function cancelRouteDraw() {
    routeDrawType = null;
  }
  async function saveRoute(input: {
    routeType: RouteType;
    vehicleType: "kleingerät" | "großgerät";
    name: string | null;
    comment: string | null;
    pathData: { type: "LineString"; coordinates: [number, number][] };
  }) {
    if (!activePlotId) throw new Error("Kein Waldstück aktiv.");
    await createRoute({ plotId: activePlotId, ...input });
    routeDrawType = null;
    // Pull the fresh overview into the map layers without a full reload.
    await loadActivePlotLayers(activePlotId);
  }

  async function addTreeAtCurrentGps() {
    if (!activePlotId) return;
    if (!("geolocation" in navigator)) {
      alert("GPS nicht verfügbar.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        goto(
          `/baeume/neu?plot=${activePlotId}&lat=${pos.coords.latitude}&lng=${pos.coords.longitude}&acc=${pos.coords.accuracy}`
        );
      },
      (err) => alert(`GPS-Fehler: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  // After Map mounts, grab the maplibre instance and wire layers.
  $effect(() => {
    if (!mapRef) return;
    const m = mapRef.instance();
    if (!m) return;
    mlMap = m;
    const onLoad = () => {
      ensureSources(m);
      updateParcelFeatures();
      if (activePlotId) {
        loadActivePlotLayers(activePlotId);
        fitToPlot(activePlotId);
      }
    };
    if (m.loaded()) onLoad();
    else m.once("load", onLoad);
  });

  $effect(() => {
    // React to plot-data changes.
    activePlotId;
    data.parcels;
    if (mlMap && layersInitialized) updateParcelFeatures();
  });
</script>

<div class="home-shell">
  <PlotSwitcher
    plots={data.plots}
    activeId={activePlotId}
    onSwitch={switchTo}
    onCreate={createPlot}
    toolActive={placementMode || routeDrawType !== null}
    userName={data.user?.name ?? ""}
  />

  <div class="relative overflow-hidden">
    <Map
      bind:this={mapRef}
      onClick={onMapClick}
      {onLongPress}
      class={placementMode ? "placing-tree" : ""}
    />

    <!-- Empty state: onboarding card overlay -->
    {#if data.plots.length === 0}
      <div
        class="absolute inset-0 grid place-items-center p-4 pointer-events-none backdrop-blur-[2px] [&>*]:pointer-events-auto"
        style="background: radial-gradient(600px 400px at 50% 40%, color-mix(in srgb, var(--color-background) 85%, transparent), transparent 70%), color-mix(in srgb, var(--color-background) 55%, transparent);"
      >
        <OnboardingCard onCreate={createPlot} />
      </div>
    {/if}

    <!-- Active-plot controls (bottom-right floating action stack).
         While the route-drawing tool is active, the stack is hidden — the
         tool owns the screen until the user accepts/cancels. -->
    {#if activePlot && !routeDrawType}
      <div
        class="absolute right-4 z-10 flex flex-col items-end gap-2"
        style="bottom: calc(1.5rem + env(safe-area-inset-bottom));"
      >
        {#if placementMode}
          <button
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-earth border font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
            style="background: var(--color-rust); border-color: color-mix(in srgb, var(--color-rust) 70%, black);"
            onclick={cancelPlacement}
          >
            <X size="1.25em" weight="bold" />
            <span>Platzierung abbrechen</span>
          </button>
        {:else}
          <a
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-ink border bg-surface/90 backdrop-blur font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0 no-underline"
            href="/waldstuecke/{activePlot.id}"
          >
            <Gear size="1.125em" />
            <span>Verwalten</span>
          </a>
          {#if treeActionError}
            <div
              class="max-w-[18rem] rounded-btn bg-surface/95 border px-3 py-2 text-xs text-crimson shadow-understory"
            >
              {treeActionError}
            </div>
          {/if}
          {#if treeCountResult != null}
            <div
              class="max-w-[18rem] rounded-btn bg-surface/95 border px-3 py-2 text-xs text-content shadow-understory"
            >
              Offiziell gezählt: <strong>{treeCountResult}</strong> Bäume
            </div>
          {/if}
          <button
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-ink border bg-surface/90 backdrop-blur font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
            aria-pressed={officialTreesVisible}
            onclick={toggleOfficialTrees}
          >
            <Tree size="1.125em" />
            <span>
              {officialTreesLoading ? "Lade Baum-Punkte…"
              : officialTreesVisible ? "Baum-Punkte ausblenden"
              : "Baum-Punkte anzeigen"}
            </span>
          </button>
          <button
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-ink border bg-surface/90 backdrop-blur font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
            onclick={countOfficialTrees}
          >
            <Calculator size="1.125em" />
            <span>{treeCountLoading ? "Zähle Bäume…" : "Bäume zählen"}</span>
          </button>
          <button
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-ink border bg-surface/90 backdrop-blur font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
            onclick={startPlacement}
          >
            <Crosshair size="1.125em" />
            <span>Baum platzieren</span>
          </button>

          <!-- "Weg zeichnen" — segmented picker per §5.4: tap to reveal the
               Anfahrt / Rückegasse choice, tap a choice to enter drawing mode. -->
          {#if routeTypePickerOpen}
            <div
              class="flex flex-col items-end gap-2 animate-rise"
              role="group"
              aria-label="Wegtyp wählen"
            >
              <button
                class="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface/95 backdrop-blur font-semibold text-sm shadow-understory hover:-translate-y-px hover:shadow-canopy"
                onclick={() => startRouteDraw("anfahrt")}
              >
                <span
                  class="inline-block w-7 h-[3px] rounded-full"
                  style="background: var(--color-pine-deep);"
                ></span>
                Anfahrt
              </button>
              <button
                class="inline-flex items-center gap-2 px-4 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface/95 backdrop-blur font-semibold text-sm shadow-understory hover:-translate-y-px hover:shadow-canopy"
                onclick={() => startRouteDraw("rueckegasse")}
              >
                <span
                  class="inline-block w-7 h-[3px] rounded-full"
                  style="background: repeating-linear-gradient(90deg, var(--color-pine-deep) 0 4px, transparent 4px 8px);"
                ></span>
                Rückegasse
              </button>
            </div>
          {/if}
          <button
            class="inline-flex items-center gap-2 px-4 py-3 min-h-[46px] rounded-pill text-ink border bg-surface/90 backdrop-blur font-semibold text-sm shadow-understory transition hover:-translate-y-px hover:shadow-canopy active:translate-y-0"
            aria-expanded={routeTypePickerOpen}
            onclick={() => (routeTypePickerOpen = !routeTypePickerOpen)}
          >
            <Path size="1.125em" />
            <span>Weg zeichnen</span>
          </button>
          <button
            class="inline-flex items-center gap-2 px-5 py-3 min-h-[52px] rounded-pill text-earth border font-semibold text-sm shadow-canopy transition hover:-translate-y-px active:translate-y-0"
            style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep); box-shadow: var(--shadow-canopy), inset 0 1px 0 rgba(255,255,255,0.08);"
            onclick={addTreeAtCurrentGps}
          >
            <Plus size="1.25em" weight="bold" />
            <span>Baum hier hinzufügen</span>
          </button>
        {/if}
      </div>
    {/if}

    <!-- Placement-mode top banner -->
    {#if placementMode}
      <div
        class="absolute left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-3 pl-4 pr-2 py-2 rounded-pill text-earth font-medium text-sm shadow-canopy animate-rise"
        style="top: calc(0.75rem + env(safe-area-inset-top)); background: var(--color-pine-deep);"
      >
        <span class="w-2 h-2 rounded-full bg-ember animate-breathe"></span>
        <span>Tippe, um Baum zu setzen</span>
        <button
          class="w-7 h-7 min-h-0 grid place-items-center rounded-full text-earth border-0"
          style="background: color-mix(in srgb, var(--color-earth) 14%, transparent);"
          onclick={cancelPlacement}
          aria-label="Abbrechen"
        >
          <X size="0.9em" weight="bold" />
        </button>
      </div>
    {/if}

    <!-- Route drawing tool (Anfahrt / Rückegasse) — mounted only while
         active. Owns the canvas while alive: pan/zoom is locked, taps and
         long-press on the home page are no-ops (see guards above). -->
    {#if routeDrawType && mlMap && activePlotId}
      <RouteDrawTool
        {mlMap}
        initialType={routeDrawType}
        onCancel={cancelRouteDraw}
        onSave={saveRoute}
      />
    {/if}

    <!-- Switch toast while a tool is active -->
    {#if tapToast}
      <div
        class="absolute left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-3 pl-4 pr-3 py-2 rounded-pill bg-surface border shadow-canopy animate-rise"
        style="bottom: calc(4rem + env(safe-area-inset-bottom));"
        role="status"
      >
        <span class="text-sm text-content">Zu diesem Waldstück wechseln?</span>
        <button
          class="px-3 py-2 min-h-[34px] rounded-pill text-earth border-0 font-semibold text-[0.8125rem]"
          style="background: var(--color-pine);"
          onclick={() => {
            placementMode = false;
            routeDrawType = null;
            const id = tapToast!.targetPlotId;
            tapToast = null;
            switchTo(id);
          }}
        >
          Wechseln
        </button>
        <button
          class="w-7 h-7 min-h-0 grid place-items-center rounded-full text-content-muted bg-transparent border-0 hover:text-ink hover:bg-surface-muted"
          onclick={() => (tapToast = null)}
          aria-label="Verwerfen"
        >
          <X size="1em" />
        </button>
      </div>
    {/if}
  </div>
</div>
