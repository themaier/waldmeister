<script lang="ts">
  // §5.2 Home / Waldstück-Übersicht.
  // One persistent MapLibre instance; we switch "active" plot by flying the
  // camera rather than navigating routes.

  import { goto } from "$app/navigation";
  import Map from "$lib/components/Map.svelte";
  import PlotSwitcher from "$lib/components/PlotSwitcher.svelte";
  import OnboardingCard from "$lib/components/OnboardingCard.svelte";
  import RouteDrawTool from "$lib/components/RouteDrawTool.svelte";
  import AreaDrawTool from "$lib/components/AreaDrawTool.svelte";
  import { boundsOfPolygons, shouldFlyTo } from "$lib/geo";
  import {
    Camera,
    Crosshair,
    X,
    Gear,
    Tree,
    Calculator,
    Path,
    Polygon as PolygonIcon,
  } from "phosphor-svelte";
  import type { PageData } from "./$types";
  import maplibregl from "maplibre-gl";
  import { getPlotOverview } from "./trees.remote";
  import { officialTreeDotsForPlot } from "./plots.remote";
  import { createRoute } from "./access-routes.remote";
  import { createArea, deleteArea } from "./areas.remote";
  import {
    HEALTH_LABELS,
    ROUTE_TYPE_LABELS,
    TREE_TYPE_LABELS,
    VEHICLE_TYPE_LABELS,
    type RouteType,
  } from "$lib/enums";

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
  let areasForActive = $state<
    {
      id: string;
      comment: string | null;
      appliedTreeStatus: string | null;
      geometry: { type: "Polygon"; coordinates: [number, number][][] };
    }[]
  >([]);
  // Bereich drawing + selection. While `areaDrawActive` is true the
  // AreaDrawTool owns the canvas. After commit, the most recently drawn
  // polygon's interior trees become the current "selection" so the user can
  // see at a glance which trees a freshly painted Bereich covers.
  let areaDrawActive = $state(false);
  let areaActionError = $state<string | null>(null);
  let selectedAreaId = $state<string | null>(null);
  let selectedTreeIds = $state<Record<string, true>>({});
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
  const activeParcels = $derived(
    data.parcels.filter((p) => p.plotId === activePlotId)
  );
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

    // Areas (Bereich) — saved freehand polygons. Drawn before the trees
    // layer so tree dots sit visibly on top of the area fill.
    map.addSource("areas", {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: "areas-fill",
      type: "fill",
      source: "areas",
      paint: {
        "fill-color": [
          "case",
          ["==", ["get", "isSelected"], true],
          "#d4a23c",
          "#c98f2a",
        ],
        "fill-opacity": [
          "case",
          ["==", ["get", "isSelected"], true],
          0.28,
          0.14,
        ],
      },
    });
    map.addLayer({
      id: "areas-stroke",
      type: "line",
      source: "areas",
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "isSelected"], true],
          "#b65a1f",
          "#c98f2a",
        ],
        "line-width": [
          "case",
          ["==", ["get", "isSelected"], true],
          2.5,
          1.5,
        ],
        "line-opacity": 0.95,
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
        "circle-stroke-color": [
          "case",
          ["==", ["get", "isSelected"], true],
          "#b65a1f",
          "#f5f1e6",
        ],
        "circle-stroke-width": [
          "case",
          ["==", ["get", "isSelected"], true],
          3.5,
          2,
        ],
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

  // Ray-casting point-in-polygon — handy for highlighting the trees that
  // sit inside a freshly drawn Bereich without round-tripping the server.
  function pointInRing(
    pt: [number, number],
    ring: [number, number][]
  ): boolean {
    let inside = false;
    const [x, y] = pt;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersects =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
      if (intersects) inside = !inside;
    }
    return inside;
  }
  function pointInPolygon(
    pt: [number, number],
    poly: { coordinates: [number, number][][] }
  ): boolean {
    if (poly.coordinates.length === 0) return false;
    if (!pointInRing(pt, poly.coordinates[0])) return false;
    for (let i = 1; i < poly.coordinates.length; i++) {
      if (pointInRing(pt, poly.coordinates[i])) return false;
    }
    return true;
  }
  function treesInsideArea(area: {
    geometry: { coordinates: [number, number][][] };
  }): string[] {
    const ids: string[] = [];
    for (const t of treesForActive) {
      const pt: [number, number] = [Number(t.longitude), Number(t.latitude)];
      if (pointInPolygon(pt, area.geometry)) ids.push(t.id);
    }
    return ids;
  }

  function pushTreeFeatures() {
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
            isSelected: !!selectedTreeIds[t.id],
          },
        })),
      }
    );
  }

  function pushAreaFeatures() {
    if (!mlMap || !layersInitialized) return;
    (mlMap.getSource("areas") as maplibregl.GeoJSONSource | undefined)?.setData(
      {
        type: "FeatureCollection",
        features: areasForActive.map((a) => ({
          type: "Feature",
          id: a.id,
          geometry: a.geometry,
          properties: {
            areaId: a.id,
            isSelected: a.id === selectedAreaId,
          },
        })),
      }
    );
  }

  async function loadActivePlotLayers(plotId: string | null) {
    if (!plotId) {
      treesForActive = [];
      routesForActive = [];
      areasForActive = [];
    } else {
      try {
        const body = await getPlotOverview(plotId).run();
        treesForActive = body.trees;
        routesForActive = body.routes;
        areasForActive = (body.areas ?? []) as typeof areasForActive;
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
    selectedAreaId = null;
    selectedTreeIds = {};
    areaActionError = null;
    if (!mlMap || !layersInitialized) return;
    pushTreeFeatures();
    pushAreaFeatures();
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

  function selectArea(areaId: string | null) {
    selectedAreaId = areaId;
    if (!areaId) {
      selectedTreeIds = {};
    } else {
      const area = areasForActive.find((a) => a.id === areaId);
      if (!area) {
        selectedTreeIds = {};
      } else {
        const ids = treesInsideArea(area);
        const next: Record<string, true> = {};
        for (const id of ids) next[id] = true;
        selectedTreeIds = next;
      }
    }
    pushTreeFeatures();
    pushAreaFeatures();
  }

  function clearSelection() {
    selectArea(null);
  }

  function startAreaDraw() {
    placementMode = false;
    routeDrawType = null;
    routeTypePickerOpen = false;
    areaActionError = null;
    areaDrawActive = true;
  }
  function cancelAreaDraw() {
    areaDrawActive = false;
  }
  async function completeAreaDraw(polygon: {
    type: "Polygon";
    coordinates: [number, number][][];
  }) {
    if (!activePlotId) {
      areaDrawActive = false;
      return;
    }
    try {
      const { areaId } = await createArea({
        plotId: activePlotId,
        geometry: polygon,
      });
      // Refresh the overview so the new area is part of the regular list,
      // then mark it as the current selection.
      await loadActivePlotLayers(activePlotId);
      selectArea(areaId);
    } catch (e) {
      areaActionError =
        e instanceof Error ? e.message : "Bereich konnte nicht gespeichert werden.";
    } finally {
      areaDrawActive = false;
    }
  }

  async function removeArea(areaId: string) {
    if (!activePlotId) return;
    try {
      await deleteArea(areaId);
      if (selectedAreaId === areaId) clearSelection();
      await loadActivePlotLayers(activePlotId);
    } catch (e) {
      areaActionError =
        e instanceof Error ? e.message : "Bereich konnte nicht gelöscht werden.";
    }
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
    // Route/area drawing owns the canvas — let the tool handle taps itself.
    if (routeDrawType || areaDrawActive) return;
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
    if (routeDrawType || areaDrawActive) return; // tool owns gestures
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
    areaDrawActive = false;
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
    pathData:
      | { type: "LineString"; coordinates: [number, number][] }
      | { type: "MultiLineString"; coordinates: [number, number][][] };
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
    toolActive={placementMode || routeDrawType !== null || areaDrawActive}
    userName={data.user?.name ?? ""}
  />

  <div class="home-map">
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

    <!-- Single primary action overlaid on the map: take a photo / add a tree
         at the current GPS position. All other controls live in the
         scrollable section below so the start screen stays uncluttered. -->
    {#if activePlot && !routeDrawType && !areaDrawActive}
      <div
        class="absolute right-4 z-10 flex flex-col items-end gap-2"
        style="bottom: calc(1.25rem + env(safe-area-inset-bottom));"
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
          <button
            class="grid place-items-center w-14 h-14 rounded-full text-earth border shadow-canopy transition hover:-translate-y-px active:translate-y-0"
            style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep); box-shadow: var(--shadow-canopy), inset 0 1px 0 rgba(255,255,255,0.08);"
            onclick={addTreeAtCurrentGps}
            aria-label="Baum hier fotografieren"
            title="Baum hier fotografieren"
          >
            <Camera size="1.5em" weight="fill" />
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

    <!-- Bereich drawing tool — auto-closes the polygon on finger-up. -->
    {#if areaDrawActive && mlMap && activePlotId}
      <AreaDrawTool
        {mlMap}
        onCancel={cancelAreaDraw}
        onComplete={completeAreaDraw}
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

  <!-- Scrollable section beneath the map: three grouped cards — the
       Waldstück itself (parcels, infrastructure, manage), the Bäume on it,
       and the Bereich tool/list. Hidden while a tool is active so the
       user's focus stays on the map. -->
  {#if activePlot && !routeDrawType && !placementMode && !areaDrawActive}
    <section class="home-scroll">
      <!-- ===== Waldstück ===== -->
      <article
        class="flex flex-col gap-3 p-4 rounded-2xl bg-surface border shadow-understory"
      >
        <header class="flex items-start gap-3">
          <div class="flex-1 min-w-0 flex flex-col gap-[2px]">
            <span class="eyebrow">Waldstück</span>
            <h2
              class="font-serif font-medium text-[1.375rem] leading-tight tracking-tight text-ink m-0 truncate"
              style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
              title={activePlot.name ?? "Ohne Name"}
            >
              {activePlot.name ?? "Ohne Name"}
            </h2>
            <p class="text-xs text-content-muted">
              {activeParcels.length}
              {activeParcels.length === 1 ? "Flurstück" : "Flurstücke"} ·
              {routesForActive.length}
              {routesForActive.length === 1 ? "Weg" : "Wege"} ·
              {areasForActive.length}
              {areasForActive.length === 1 ? "Bereich" : "Bereiche"}
            </p>
          </div>
          <a
            class="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-pill text-ink border bg-surface font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy no-underline"
            href="/waldstuecke/{activePlot.id}"
          >
            <Gear size="1em" />
            Verwalten
          </a>
        </header>

        <div class="flex flex-col gap-1.5">
          <span class="eyebrow">Flurstücke</span>
          <p class="text-sm text-content m-0">
            {#if activeParcels.length === 0}
              Keine Flurstücke zugeordnet.
            {:else}
              {activeParcels.map((p) => p.cadastralId).join(", ")}
            {/if}
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <h3
              class="text-xs font-semibold uppercase tracking-wider text-content-muted m-0"
            >
              Wege ({routesForActive.length})
            </h3>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] rounded-pill text-ink border bg-surface font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy"
              aria-expanded={routeTypePickerOpen}
              onclick={() => (routeTypePickerOpen = !routeTypePickerOpen)}
            >
              <Path size="1em" />
              Weg zeichnen
            </button>
          </div>
          {#if routeTypePickerOpen}
            <div
              class="grid grid-cols-2 gap-2 animate-rise"
              role="group"
              aria-label="Wegtyp wählen"
            >
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[38px] rounded-pill text-ink border bg-surface font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy"
                onclick={() => startRouteDraw("anfahrt")}
              >
                <span
                  class="inline-block w-6 h-[3px] rounded-full"
                  style="background: #2563eb;"
                ></span>
                Anfahrt
              </button>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[38px] rounded-pill text-ink border bg-surface font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy"
                onclick={() => startRouteDraw("rueckegasse")}
              >
                <span
                  class="inline-block w-6 h-[3px] rounded-full"
                  style="background: repeating-linear-gradient(90deg, #60a5fa 0 4px, transparent 4px 8px);"
                ></span>
                Rückegasse
              </button>
            </div>
          {/if}
          {#if routesForActive.length === 0}
            <p class="text-sm text-content-muted m-0">
              Noch keine Wege gezeichnet.
            </p>
          {:else}
            <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
              {#each routesForActive as r (r.id)}
                <li
                  class="flex items-center justify-between gap-3 px-3 py-2 rounded-btn bg-surface-muted border"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="inline-block w-6 h-[3px] rounded-full flex-shrink-0"
                      style={r.routeType === "rueckegasse"
                        ? "background: repeating-linear-gradient(90deg, #60a5fa 0 4px, transparent 4px 8px);"
                        : "background: #2563eb;"}
                      aria-hidden="true"
                    ></span>
                    <span class="text-sm text-ink font-medium truncate">
                      {r.name ??
                        ROUTE_TYPE_LABELS[
                          r.routeType as keyof typeof ROUTE_TYPE_LABELS
                        ]}
                    </span>
                  </div>
                  <span class="text-xs text-content-muted whitespace-nowrap">
                    {VEHICLE_TYPE_LABELS[
                      r.vehicleType as keyof typeof VEHICLE_TYPE_LABELS
                    ] ?? r.vehicleType}
                  </span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </article>

      <!-- ===== Bäume ===== -->
      <article
        class="flex flex-col gap-3 p-4 rounded-2xl bg-surface border shadow-understory"
      >
        <header class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0 flex flex-col gap-[2px]">
            <span class="eyebrow">Bäume</span>
            <h2
              class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
              style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
            >
              {treesForActive.length} erfasst
            </h2>
          </div>
        </header>

        <div class="grid grid-cols-2 gap-2">
          <button
            class="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface font-semibold text-sm shadow-understory hover:-translate-y-px hover:shadow-canopy"
            onclick={startPlacement}
          >
            <Crosshair size="1.125em" />
            <span>Baum platzieren</span>
          </button>
          <button
            class="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface font-semibold text-sm shadow-understory hover:-translate-y-px hover:shadow-canopy"
            aria-pressed={officialTreesVisible}
            onclick={toggleOfficialTrees}
          >
            <Tree size="1.125em" />
            <span class="truncate">
              {officialTreesLoading ? "Lade…"
              : officialTreesVisible ? "Punkte aus"
              : "Baum-Punkte"}
            </span>
          </button>
          <button
            class="col-span-2 inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface font-semibold text-sm shadow-understory hover:-translate-y-px hover:shadow-canopy"
            onclick={countOfficialTrees}
          >
            <Calculator size="1.125em" />
            <span>{treeCountLoading ? "Zähle…" : "Bäume zählen"}</span>
          </button>
        </div>

        {#if treeActionError}
          <div
            class="rounded-btn bg-surface-muted border px-3 py-2 text-xs text-crimson"
          >
            {treeActionError}
          </div>
        {/if}
        {#if treeCountResult != null}
          <div
            class="rounded-btn bg-surface-muted border px-3 py-2 text-xs text-content"
          >
            Offiziell gezählt: <strong>{treeCountResult}</strong> Bäume
          </div>
        {/if}

        {#if treesForActive.length === 0}
          <p class="text-sm text-content-muted m-0">
            Noch keine Bäume erfasst. Tippe auf das Kamera-Symbol oben, um den
            ersten Baum hier hinzuzufügen.
          </p>
        {:else}
          <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
            {#each treesForActive as t (t.id)}
              <li
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-btn border transition"
                class:bg-surface-muted={!selectedTreeIds[t.id]}
                style={selectedTreeIds[t.id]
                  ? "background: color-mix(in srgb, var(--color-ember) 14%, var(--color-surface)); border-color: var(--color-rust);"
                  : ""}
              >
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style="background: {t.healthStatus === 'healthy'
                      ? '#5d7a4a'
                      : t.healthStatus === 'must-watch'
                        ? '#d4a23c'
                        : t.healthStatus === 'infected'
                          ? '#c76a2b'
                          : '#4a4a4a'};"
                    aria-hidden="true"
                  ></span>
                  <span class="text-sm text-ink font-medium truncate">
                    {TREE_TYPE_LABELS[
                      t.treeTypeId as keyof typeof TREE_TYPE_LABELS
                    ] ?? t.treeTypeId}
                  </span>
                </div>
                <span class="text-xs text-content-muted whitespace-nowrap">
                  {HEALTH_LABELS[
                    t.healthStatus as keyof typeof HEALTH_LABELS
                  ] ?? t.healthStatus}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </article>

      <!-- ===== Bereich ===== -->
      <article
        class="flex flex-col gap-3 p-4 rounded-2xl bg-surface border shadow-understory"
      >
        <header class="flex items-start justify-between gap-3">
          <div class="flex-1 min-w-0 flex flex-col gap-[2px]">
            <span class="eyebrow">Bereich</span>
            <h2
              class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
              style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
            >
              {areasForActive.length} markiert
            </h2>
          </div>
          <button
            class="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-pill text-earth border font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy"
            style="background: var(--color-amber); border-color: color-mix(in srgb, var(--color-amber) 70%, black);"
            onclick={startAreaDraw}
          >
            <PolygonIcon size="1em" weight="bold" />
            Bereich zeichnen
          </button>
        </header>

        <p class="text-xs text-content-muted m-0">
          Mit dem Finger eine Fläche auf der Karte umkreisen — Anfang und Ende
          werden automatisch verbunden, und die Bäume innerhalb werden
          markiert.
        </p>

        {#if areaActionError}
          <div
            class="rounded-btn bg-surface-muted border px-3 py-2 text-xs text-crimson"
          >
            {areaActionError}
          </div>
        {/if}

        {#if selectedAreaId}
          {@const selectedCount = Object.keys(selectedTreeIds).length}
          <div
            class="rounded-btn border px-3 py-2 flex items-center justify-between gap-3"
            style="background: color-mix(in srgb, var(--color-ember) 12%, var(--color-surface)); border-color: var(--color-rust);"
          >
            <div class="flex flex-col min-w-0">
              <span class="eyebrow">Aktuelle Auswahl</span>
              <span class="text-sm text-ink font-medium">
                {selectedCount}
                {selectedCount === 1 ? "Baum" : "Bäume"} im Bereich
              </span>
            </div>
            <button
              class="inline-flex items-center gap-1 px-3 py-1.5 min-h-[34px] rounded-pill text-ink border bg-surface font-semibold text-xs hover:border-pine"
              onclick={clearSelection}
            >
              <X size="0.95em" weight="bold" />
              Auswahl aufheben
            </button>
          </div>
        {/if}

        {#if areasForActive.length === 0}
          <p class="text-sm text-content-muted m-0">
            Noch keine Bereiche markiert.
          </p>
        {:else}
          <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
            {#each areasForActive as a, i (a.id)}
              {@const inside = treesInsideArea(a).length}
              <li
                class="flex items-center justify-between gap-3 px-3 py-2 rounded-btn border transition"
                class:bg-surface-muted={a.id !== selectedAreaId}
                style={a.id === selectedAreaId
                  ? "background: color-mix(in srgb, var(--color-ember) 14%, var(--color-surface)); border-color: var(--color-rust);"
                  : ""}
              >
                <button
                  class="flex-1 min-w-0 flex items-center gap-2 bg-transparent border-0 p-0 text-left"
                  onclick={() => selectArea(a.id)}
                  aria-pressed={a.id === selectedAreaId}
                >
                  <span
                    class="inline-block w-3 h-3 rounded-sm flex-shrink-0 border"
                    style="background: color-mix(in srgb, #c98f2a 22%, transparent); border-color: #c98f2a;"
                    aria-hidden="true"
                  ></span>
                  <span class="text-sm text-ink font-medium truncate">
                    Bereich {String(i + 1).padStart(2, "0")}
                  </span>
                  <span class="text-xs text-content-muted whitespace-nowrap">
                    · {inside}
                    {inside === 1 ? "Baum" : "Bäume"}
                  </span>
                </button>
                <button
                  class="w-8 h-8 min-h-0 grid place-items-center rounded-full bg-transparent border text-content-muted hover:text-crimson hover:border-crimson"
                  onclick={() => removeArea(a.id)}
                  aria-label="Bereich löschen"
                  title="Bereich löschen"
                >
                  <X size="0.95em" weight="bold" />
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </article>
    </section>
  {/if}
</div>
