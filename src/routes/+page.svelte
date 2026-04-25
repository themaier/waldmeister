<script lang="ts">
  // §5.2 Home / Waldstück-Übersicht.
  // One persistent MapLibre instance; we switch "active" plot by flying the
  // camera rather than navigating routes.

  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { invalidateAll } from "$app/navigation";
  import { activePlotStore } from "$lib/stores/active-plot.svelte";
  import Map from "$lib/components/Map.svelte";
  import PlotSwitcher from "$lib/components/PlotSwitcher.svelte";
  import OnboardingCard from "$lib/components/OnboardingCard.svelte";
  import RouteDrawTool from "$lib/components/RouteDrawTool.svelte";
  import AreaDrawTool from "$lib/components/AreaDrawTool.svelte";
  import AutoTextarea from "$lib/components/AutoTextarea.svelte";
  import { boundsOfPolygons, shouldFlyTo } from "$lib/geo";
  import { getBetterGpsFix, type GpsFix } from "$lib/gps";
  import {
    Camera,
    Crosshair,
    X,
    Tree,
    TreeEvergreen,
    Calculator,
    Path,
    Polygon as PolygonIcon,
    PencilSimple,
    Trash,
    Plus,
    MapTrifold,
  } from "phosphor-svelte";
  import type { PageData } from "./$types";
  import maplibregl from "maplibre-gl";
  import { getPlotOverview, officialTreeDotsForPlot } from "./trees.remote";
  import { createRoute, deleteRoute, updateRoute } from "./access-routes.remote";
  import { createArea, deleteArea } from "./areas.remote";
  import {
    createBoundaryStone,
    deleteBoundaryStone,
    getBoundaryStones,
    updateBoundaryStone,
  } from "./boundary-stones.remote";
  import { renamePlot, deletePlot } from "./plots.remote";
  import {
    HEALTH_LABELS,
    ROUTE_TYPE_LABELS,
    TREE_TYPE_LABELS,
    VEHICLE_TYPE_LABELS,
    type RouteType,
  } from "$lib/enums";

  let { data }: { data: PageData & { plots: any[]; parcels: any[] } } =
    $props();

  // Seed the session store from the load-resolved `?plot=ID` (set by the
  // Waldstück-creation redirect). Synchronous init — runs once on mount,
  // which matches the only entry path: a fresh navigation from /waldstuecke/neu.
  onMount(() => {
    if (data.requestedPlotId) activePlotStore.set(data.requestedPlotId);
  });

  let mapRef = $state<Map | undefined>();
  // Remembered selection (session-scoped store) wins while the plot still
  // exists; otherwise we fall back to the first plot from the load data so
  // that activePlotId auto-heals when the current plot is deleted.
  const activePlotId = $derived(
    activePlotStore.id && data.plots.some((p) => p.id === activePlotStore.id) ?
      activePlotStore.id
    : (data.plots[0]?.id ?? null)
  );
  let placementMode = $state(false);
  let tapToast = $state<{ targetPlotId: string } | null>(null);
  // Route-drawing state. `routeDrawType` non-null = the tool is mounted; the
  // segmented picker (§5.4 step 2) sets which type the form starts with.
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
  // Bottom panel tab — keeps the start screen uncluttered. Defaults to the
  // Waldstück overview; switches to "bereich" automatically after a Bereich
  // is drawn so the user sees what they just made.
  let activeTab = $state<"waldstueck" | "baeume" | "bereich">("waldstueck");
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
  let boundaryStonesForActive = $state<
    {
      id: string;
      description: string | null;
      latitude: number | null;
      longitude: number | null;
      gpsAccuracyM: number | null;
      widthPx: number;
      heightPx: number;
      takenAt: string;
      url: string;
    }[]
  >([]);

  let stoneFile = $state<File | null>(null);
  let stonePreview = $state<string | null>(null);
  let stoneDescription = $state("");
  let stoneCaptureGps = $state(true);
  let stoneGps = $state<GpsFix | null>(null);
  let stoneGpsCapturing = $state(false);
  let stoneSubmitting = $state(false);
  let stoneError = $state<string | null>(null);
  let stoneEditing = $state<Record<string, string>>({});
  let showStoneForm = $state(false);

  function openStoneForm() {
    showStoneForm = true;
  }
  function closeStoneForm() {
    clearStoneDraft();
    showStoneForm = false;
  }
  let routesOpen = $state(false);
  let routeEdits = $state<
    Record<
      string,
      {
        routeType: RouteType;
        vehicleType: "kleingerät" | "großgerät";
        name: string;
        comment: string;
      }
    >
  >({});

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
        "line-width": ["case", ["==", ["get", "isSelected"], true], 2.5, 1.5],
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
      id: "routes-anfahrt-a",
      type: "line",
      source: "routes",
      filter: ["!=", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-offset": -2,
        "line-width": [
          "case",
          [
            "all",
            ["==", ["get", "routeType"], "anfahrt"],
            ["==", ["get", "vehicleType"], "großgerät"],
          ],
          2.5,
          ["==", ["get", "routeType"], "anfahrt"],
          1.5,
          1,
        ],
      },
    });
    map.addLayer({
      id: "routes-anfahrt-b",
      type: "line",
      source: "routes",
      filter: ["!=", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-offset": 2,
        "line-width": [
          "case",
          [
            "all",
            ["==", ["get", "routeType"], "anfahrt"],
            ["==", ["get", "vehicleType"], "großgerät"],
          ],
          2.5,
          ["==", ["get", "routeType"], "anfahrt"],
          1.5,
          1,
        ],
      },
    });
    map.addLayer({
      id: "routes-rueckegasse-a",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-offset": -2,
        "line-width": 1.75,
        "line-dasharray": [2, 2],
      },
    });
    map.addLayer({
      id: "routes-rueckegasse-b",
      type: "line",
      source: "routes",
      filter: ["==", ["get", "routeType"], "rueckegasse"],
      paint: {
        "line-color": "#60a5fa",
        "line-offset": 2,
        "line-width": 1.75,
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
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
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
      boundaryStonesForActive = [];
    } else {
      try {
        const [body, stones] = await Promise.all([
          getPlotOverview(plotId).run(),
          getBoundaryStones(plotId).run(),
        ]);
        treesForActive = body.trees;
        routesForActive = body.routes;
        areasForActive = (body.areas ?? []) as typeof areasForActive;
        boundaryStonesForActive = stones;
      } catch {
        /* non-fatal: leave layers empty on error */
        boundaryStonesForActive = [];
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

  async function renameActivePlot() {
    if (!activePlotId) return;
    const current = activePlot?.name ?? "";
    const name = prompt("Name", current);
    if (name === null) return;
    await renamePlot({ id: activePlotId, name });
    location.reload();
  }

  async function deleteActivePlot() {
    if (!activePlotId) return;
    if (
      !confirm(
        "Waldstück und alle enthaltenen Daten (Bäume, Bereiche, Fotos, Anfahrten) löschen?"
      )
    )
      return;
    await deletePlot(activePlotId);
    location.href = "/";
  }

  async function imageSize(
    url: string
  ): Promise<{ width: number; height: number }> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
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
      getBetterGpsFix({
        minWaitMs: 3000,
        maxWaitMs: 6500,
        desiredAccuracyM: 10,
      })
        .then((fix) => {
          stoneGps = fix;
        })
        .finally(() => {
          stoneGpsCapturing = false;
        });
    }
    input.value = "";
  }

  function clearStoneDraft() {
    if (stonePreview) URL.revokeObjectURL(stonePreview);
    stoneFile = null;
    stonePreview = null;
    stoneDescription = "";
    stoneError = null;
    stoneGps = null;
    stoneGpsCapturing = false;
  }

  async function refreshBoundaryStones() {
    if (!activePlotId) {
      boundaryStonesForActive = [];
      return;
    }
    boundaryStonesForActive = await getBoundaryStones(activePlotId).run();
  }

  async function submitStone() {
    if (!activePlotId) return;
    if (!stoneFile || !stonePreview) {
      stoneError = "Bitte ein Foto auswählen.";
      return;
    }
    stoneSubmitting = true;
    stoneError = null;
    try {
      const { width, height } = await imageSize(stonePreview);
      const gps =
        stoneCaptureGps ?
          (stoneGps ??
          (await getBetterGpsFix({
            minWaitMs: 3000,
            maxWaitMs: 7000,
            desiredAccuracyM: 10,
          })))
        : null;

      const result = await createBoundaryStone({
        plotId: activePlotId,
        description: stoneDescription,
        latitude: gps?.lat ?? null,
        longitude: gps?.lng ?? null,
        gpsAccuracyM: gps?.acc ?? null,
        contentType: stoneFile.type || "image/jpeg",
        widthPx: width,
        heightPx: height,
      });

      if (!result.uploadUrl) {
        stoneError =
          "Keine Upload-URL vom Server (S3 presign fehlgeschlagen). Prüfe S3_* in .env und die Server-Logs.";
        return;
      }
      const put = await fetch(result.uploadUrl, {
        method: "PUT",
        headers: { "content-type": result.contentType },
        body: stoneFile,
      });
      if (!put.ok) {
        stoneError = `Foto-Upload fehlgeschlagen (HTTP ${put.status}).`;
        return;
      }

      clearStoneDraft();
      showStoneForm = false;
      await invalidateAll();
      await refreshBoundaryStones();
    } catch (e) {
      stoneError = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
    } finally {
      stoneSubmitting = false;
    }
  }

  async function removeStone(id: string) {
    if (!confirm("Diesen Grenzstein löschen?")) return;
    await deleteBoundaryStone(id);
    await invalidateAll();
    await refreshBoundaryStones();
  }

  function startStoneEdit(id: string, current: string | null) {
    stoneEditing[id] = current ?? "";
  }
  function cancelStoneEdit(id: string) {
    delete stoneEditing[id];
  }
  async function saveStoneEdit(id: string) {
    const text = stoneEditing[id] ?? "";
    await updateBoundaryStone({ id, description: text });
    delete stoneEditing[id];
    await invalidateAll();
    await refreshBoundaryStones();
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
    areaActionError = null;
    areaDrawActive = true;
  }
  function cancelAreaDraw() {
    areaDrawActive = false;
  }
  async function completeAreaDraw(input: {
    geometry: { type: "Polygon"; coordinates: [number, number][][] };
    comment: string | null;
    appliedTreeStatus: "healthy" | "must-watch" | "infected" | "dead" | null;
  }) {
    if (!activePlotId) {
      areaDrawActive = false;
      return;
    }
    const { areaId } = await createArea({
      plotId: activePlotId,
      geometry: input.geometry,
      comment: input.comment,
      appliedTreeStatus: input.appliedTreeStatus,
    });
    // Refresh the overview so the new area + any health-status updates from
    // the bulk apply (§5.8) are reflected, then mark the new area as the
    // current selection.
    await loadActivePlotLayers(activePlotId);
    selectArea(areaId);
    areaDrawActive = false;
    // Switch to the Bereich tab so the user sees the result of their action.
    activeTab = "bereich";
  }

  async function removeArea(areaId: string) {
    if (!activePlotId) return;
    try {
      await deleteArea(areaId);
      if (selectedAreaId === areaId) clearSelection();
      await loadActivePlotLayers(activePlotId);
    } catch (e) {
      areaActionError =
        e instanceof Error ?
          e.message
        : "Bereich konnte nicht gelöscht werden.";
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
    activePlotStore.set(plotId);
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
             <p class="text-sm opacity-70">Nicht in deinem Besitz.</p>
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

  function startRouteDraw() {
    placementMode = false;
    areaDrawActive = false;
    // Start drawing immediately; user picks Typ after drawing in the sheet.
    routeDrawType = "anfahrt";
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

  function startRouteEdit(r: any) {
    routeEdits[r.id] = {
      routeType: r.routeType,
      vehicleType: r.vehicleType,
      name: r.name ?? "",
      comment: r.comment ?? "",
    };
  }
  function cancelRouteEdit(id: string) {
    delete routeEdits[id];
  }
  async function saveRouteEdit(id: string) {
    const draft = routeEdits[id];
    if (!draft) return;
    await updateRoute({
      id,
      routeType: draft.routeType,
      vehicleType: draft.routeType === "rueckegasse" ? "kleingerät" : draft.vehicleType,
      name: draft.name.trim() || null,
      comment: draft.comment.trim() || null,
    });
    delete routeEdits[id];
    if (activePlotId) await loadActivePlotLayers(activePlotId);
  }
  async function removeRoute(id: string) {
    if (!confirm("Diesen Weg löschen?")) return;
    await deleteRoute(id);
    if (activePlotId) await loadActivePlotLayers(activePlotId);
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
    toolActive={placementMode || routeDrawType !== null || areaDrawActive}
    userName={data.user?.name ?? ""}
  />

  <div class="home-map !sticky !top-[61px] !z-0">
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
            <span class="relative grid place-items-center">
              <TreeEvergreen size="1.75em" weight="fill" />
              <span
                class="absolute grid place-items-center w-4 h-4 rounded-full"
                style="top: 0; right: 0; transform: translate(40%, -40%); background: var(--color-pine);"
                aria-hidden="true"
              >
                <Plus size="0.7em" weight="bold" />
              </span>
            </span>
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
          class="w-7 h-7 min-h-0 min-w-0 grid place-items-center rounded-full text-earth border-0"
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

    <!-- Bereich drawing tool — auto-closes the polygon on finger-up, then
         opens an inline form for Kommentar + Baumstatus (§5.8). -->
    {#if areaDrawActive && mlMap && activePlotId}
      <AreaDrawTool
        {mlMap}
        trees={treesForActive}
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
          class="w-7 h-7 min-h-0 min-w-0 grid place-items-center rounded-full text-content-muted bg-transparent border-0 hover:text-ink hover:bg-surface-muted"
          onclick={() => (tapToast = null)}
          aria-label="Verwerfen"
        >
          <X size="1em" />
        </button>
      </div>
    {/if}
  </div>

  <!-- Scrollable section beneath the map: a tab strip splits Waldstück /
       Bäume / Bereich into one focused view at a time. Hidden while a tool
       is active so the user's focus stays on the map. -->
  {#if activePlot && !routeDrawType && !placementMode && !areaDrawActive}
    <section class="home-scroll relative z-10">
      <!-- Tab strip — segmented control at the top of the bottom panel. -->
      <div
        role="tablist"
        aria-label="Bereich-Auswahl"
        class="grid grid-cols-3 gap-1 p-1 rounded-pill bg-surface-muted border"
      >
        <button
          role="tab"
          aria-selected={activeTab === "waldstueck"}
          class="inline-flex items-center justify-center gap-1.5 px-2 py-2 min-h-[40px] rounded-pill text-[0.8125rem] font-semibold transition truncate"
          class:text-content-muted={activeTab !== "waldstueck"}
          style={activeTab === "waldstueck" ?
            "background: var(--color-surface); color: var(--color-ink); box-shadow: var(--shadow-duff);"
          : ""}
          onclick={() => (activeTab = "waldstueck")}
        >
          <Tree size="1em" weight="regular" />
          <span>Waldstück</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "baeume"}
          class="inline-flex items-center justify-center gap-1.5 px-2 py-2 min-h-[40px] rounded-pill text-[0.8125rem] font-semibold transition truncate"
          class:text-content-muted={activeTab !== "baeume"}
          style={activeTab === "baeume" ?
            "background: var(--color-surface); color: var(--color-ink); box-shadow: var(--shadow-duff);"
          : ""}
          onclick={() => (activeTab = "baeume")}
        >
          <Crosshair size="1em" weight="regular" />
          <span
            >Bäume <span class="text-content-muted font-normal"
              >{treesForActive.length}</span
            ></span
          >
        </button>
        <button
          role="tab"
          aria-selected={activeTab === "bereich"}
          class="inline-flex items-center justify-center gap-1.5 px-2 py-2 min-h-[40px] rounded-pill text-[0.8125rem] font-semibold transition truncate"
          class:text-content-muted={activeTab !== "bereich"}
          style={activeTab === "bereich" ?
            "background: var(--color-surface); color: var(--color-ink); box-shadow: var(--shadow-duff);"
          : ""}
          onclick={() => (activeTab = "bereich")}
        >
          <PolygonIcon size="1em" weight="regular" />
          <span
            >Bereich <span class="text-content-muted font-normal"
              >{areasForActive.length}</span
            ></span
          >
        </button>
      </div>

      {#if activeTab === "waldstueck"}
        <article class="flex flex-col gap-4 animate-rise">
          <!-- Header row: name + Verwalten -->
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
          </header>

          <!-- Wege -->
          <div
            class="flex flex-col gap-2 p-4 rounded-2xl bg-surface border shadow-understory"
          >
            <div class="flex items-center justify-between gap-2">
              <button
                class="inline-flex items-center gap-2 px-3 py-1.5 min-h-[34px] rounded-pill text-ink border bg-surface-muted font-semibold text-xs hover:border-pine"
                onclick={() => (routesOpen = !routesOpen)}
                aria-expanded={routesOpen}
              >
                Wege{" "}
                <span class="text-content-muted font-normal">
                  ({routesForActive.length})
                </span>
                <span class="text-content-muted" aria-hidden="true">
                  {routesOpen ? "▲" : "▼"}
                </span>
              </button>
              <button
                class="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[34px] rounded-pill text-ink border bg-surface-muted font-semibold text-xs hover:border-pine"
                onclick={startRouteDraw}
              >
                <Path size="1em" />
                Wege einzeichnen
              </button>
            </div>

            {#if routesOpen && routesForActive.length === 0}
              <p class="text-sm text-content-muted m-0">
                Noch keine Wege gezeichnet.
              </p>
            {:else if routesOpen}
              <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
                {#each routesForActive as r (r.id)}
                  {@const editing = routeEdits[r.id]}
                  <li class="flex flex-col gap-2 px-3 py-2 rounded-btn bg-surface-muted border">
                    <div class="flex items-center justify-between gap-3">
                      <div class="flex items-center gap-2 min-w-0">
                        <span
                          class="inline-block w-6 h-[3px] rounded-full flex-shrink-0"
                          style={r.routeType === "rueckegasse" ?
                            "background: repeating-linear-gradient(90deg, #60a5fa 0 4px, transparent 4px 8px) 0 35%/100% 2px no-repeat, repeating-linear-gradient(90deg, #60a5fa 0 4px, transparent 4px 8px) 0 70%/100% 2px no-repeat;"
                          : "background: linear-gradient(#2563eb,#2563eb) 0 35%/100% 2px no-repeat, linear-gradient(#2563eb,#2563eb) 0 70%/100% 2px no-repeat;"}
                          aria-hidden="true"
                        ></span>
                        <span class="text-sm text-ink font-medium truncate">
                          {r.name ??
                            ROUTE_TYPE_LABELS[
                              r.routeType as keyof typeof ROUTE_TYPE_LABELS
                            ]}
                        </span>
                      </div>

                      <div class="flex items-center gap-2 flex-shrink-0">
                        <span class="text-xs text-content-muted whitespace-nowrap">
                          {VEHICLE_TYPE_LABELS[
                            r.vehicleType as keyof typeof VEHICLE_TYPE_LABELS
                          ] ?? r.vehicleType}
                        </span>
                        <button
                          class="inline-flex items-center justify-center w-8 h-8 rounded-btn border text-content hover:border-pine transition"
                          onclick={() =>
                            editing ? cancelRouteEdit(r.id) : startRouteEdit(r)}
                          aria-label={editing ? "Bearbeiten schließen" : "Weg bearbeiten"}
                          title={editing ? "Bearbeiten schließen" : "Weg bearbeiten"}
                        >
                          <PencilSimple size="0.875em" />
                        </button>
                        <button
                          class="inline-flex items-center justify-center w-8 h-8 rounded-btn border text-crimson hover:border-crimson transition"
                          onclick={() => removeRoute(r.id)}
                          aria-label="Weg löschen"
                          title="Weg löschen"
                        >
                          <Trash size="0.875em" />
                        </button>
                      </div>
                    </div>

                    {#if editing}
                      <div class="grid gap-2">
                        <div class="grid grid-cols-2 gap-2">
                          <label class="flex flex-col gap-1 text-xs">
                            <span class="text-content-muted font-semibold">Typ</span>
                            <select
                              class="px-2 py-2 min-h-[38px] rounded-btn bg-earth border text-ink text-xs focus:outline-none focus:border-pine"
                              bind:value={routeEdits[r.id].routeType}
                            >
                              <option value="rueckegasse">Rückegasse</option>
                              <option value="anfahrt">Straße</option>
                            </select>
                          </label>
                          <label class="flex flex-col gap-1 text-xs">
                            <span class="text-content-muted font-semibold">Gerät</span>
                            <select
                              class="px-2 py-2 min-h-[38px] rounded-btn bg-earth border text-ink text-xs focus:outline-none focus:border-pine"
                              bind:value={routeEdits[r.id].vehicleType}
                              disabled={routeEdits[r.id].routeType === "rueckegasse"}
                            >
                              <option value="kleingerät">Kleingerät</option>
                              <option value="großgerät">Großgerät</option>
                            </select>
                          </label>
                        </div>

                        <label class="flex flex-col gap-1 text-xs">
                          <span class="text-content-muted font-semibold">Name</span>
                          <input
                            class="px-2 py-2 min-h-[38px] rounded-btn bg-earth border text-ink text-xs focus:outline-none focus:border-pine"
                            placeholder="(optional)"
                            bind:value={routeEdits[r.id].name}
                            maxlength="120"
                          />
                        </label>

                        <label class="flex flex-col gap-1 text-xs">
                          <span class="text-content-muted font-semibold">Kommentar</span>
                          <textarea
                            class="px-2 py-2 min-h-[64px] rounded-btn bg-earth border text-ink text-xs focus:outline-none focus:border-pine resize-y"
                            rows="2"
                            placeholder="(optional)"
                            bind:value={routeEdits[r.id].comment}
                            maxlength="2000"
                          ></textarea>
                        </label>

                        <div class="flex justify-end gap-2">
                          <button
                            class="px-3 py-2 min-h-[38px] rounded-pill bg-transparent border text-ink font-semibold text-xs hover:border-pine"
                            onclick={() => cancelRouteEdit(r.id)}
                          >
                            Abbrechen
                          </button>
                          <button
                            class="px-4 py-2 min-h-[38px] rounded-pill text-earth border font-semibold text-xs shadow-understory"
                            style="background: var(--color-pine);"
                            onclick={() => saveRouteEdit(r.id)}
                          >
                            Speichern
                          </button>
                        </div>
                      </div>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <!-- Plot-level analyses: official BayernAtlas tree dots + count.
               These belong to the Waldstück, not to the user's own
               inventory, so they live here rather than under "Bäume". -->
          <div
            class="flex flex-col gap-2 p-4 rounded-2xl bg-surface border shadow-understory"
          >
            <h3
              class="text-xs font-semibold uppercase tracking-wider text-content-muted m-0"
            >
              Offizielle Daten (BayernAtlas)
            </h3>
            <p class="text-xs text-content-muted m-0">
              Einzelbaum-Punkte aus dem amtlichen Datensatz für dieses
              Waldstück.
            </p>
            <div class="grid grid-cols-2 gap-2">
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface-muted font-semibold text-sm hover:border-pine disabled:opacity-60"
                aria-pressed={officialTreesVisible}
                onclick={toggleOfficialTrees}
                disabled={officialTreesLoading}
              >
                <Tree size="1.125em" />
                <span class="truncate">
                  {officialTreesLoading ? "Lade…"
                  : officialTreesVisible ? "Punkte aus"
                  : "Bäume makieren"}
                </span>
              </button>
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface-muted font-semibold text-sm hover:border-pine disabled:opacity-60"
                onclick={countOfficialTrees}
                disabled={treeCountLoading}
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
          </div>

          <!-- Grenzsteine -->
          <div
            class="flex flex-col gap-2 p-4 rounded-2xl bg-surface border shadow-understory"
          >
            <h3
              class="text-xs font-semibold uppercase tracking-wider text-content-muted m-0"
            >
              Grenzsteine ({boundaryStonesForActive.length})
            </h3>
            <p class="text-xs text-content-muted m-0">
              Foto, Beschreibung und (optional) Standort jedes Grenzsteins.
            </p>

            {#if boundaryStonesForActive.length > 0}
              <ul class="flex flex-col gap-2 list-none p-0 m-0">
                {#each boundaryStonesForActive as st (st.id)}
                  <li
                    class="flex gap-3 items-start border border-hairline rounded-btn p-3 bg-earth"
                  >
                    {#if st.url}
                      <a
                        href={st.url}
                        target="_blank"
                        rel="noopener"
                        class="block flex-shrink-0"
                      >
                        <img
                          src={st.url}
                          alt="Grenzstein"
                          class="w-20 h-20 object-cover rounded-btn border"
                        />
                      </a>
                    {:else}
                      <div
                        class="w-20 h-20 rounded-btn border border-dashed grid place-items-center text-content-faint flex-shrink-0"
                      >
                        <Camera size="1.25em" />
                      </div>
                    {/if}
                    <div class="flex-1 min-w-0 flex flex-col gap-2">
                      {#if stoneEditing[st.id] !== undefined}
                        <textarea
                          class="w-full px-3 py-2 min-h-[64px] rounded-btn border bg-surface text-[0.9rem] text-ink focus:outline-none focus:border-pine focus:shadow-ring-focus transition"
                          rows="3"
                          bind:value={stoneEditing[st.id]}
                        ></textarea>
                        <div class="flex gap-2">
                          <button
                            class="px-3 py-1.5 min-h-[36px] rounded-btn text-earth border font-semibold text-xs"
                            style="background: linear-gradient(180deg, var(--color-pine), var(--color-pine-deep)); border-color: var(--color-pine-deep);"
                            onclick={() => saveStoneEdit(st.id)}
                          >
                            Speichern
                          </button>
                          <button
                            class="px-3 py-1.5 min-h-[36px] rounded-btn bg-surface border text-content text-xs font-semibold"
                            onclick={() => cancelStoneEdit(st.id)}
                          >
                            Abbrechen
                          </button>
                        </div>
                      {:else}
                        <p
                          class="text-sm text-ink whitespace-pre-wrap leading-snug min-h-[1em] m-0"
                        >
                          {st.description?.trim() || "— keine Beschreibung —"}
                        </p>
                      {/if}

                      <div
                        class="flex flex-wrap items-center gap-2 text-xs text-content-muted"
                      >
                        {#if st.latitude !== null && st.longitude !== null}
                          <span
                            class="inline-flex items-center gap-1 font-mono"
                          >
                            <MapTrifold size="0.875em" />
                            {st.latitude.toFixed(5)}, {st.longitude.toFixed(5)}
                            {#if st.gpsAccuracyM != null}· ±{st.gpsAccuracyM.toFixed(
                                0
                              )} m{/if}
                          </span>
                        {:else}
                          <span class="italic">ohne Standort</span>
                        {/if}
                      </div>

                      {#if stoneEditing[st.id] === undefined}
                        <div class="flex gap-2">
                          <button
                            class="inline-flex items-center gap-1 px-2 py-1 min-h-[32px] rounded-btn border text-content text-xs hover:border-pine transition"
                            onclick={() =>
                              startStoneEdit(st.id, st.description)}
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

            {#if !showStoneForm}
              <button
                class="inline-flex items-center justify-center gap-2 px-3 py-2.5 min-h-[42px] rounded-pill text-ink border bg-surface-muted font-semibold text-xs hover:border-pine self-start"
                onclick={openStoneForm}
              >
                <Plus size="1.125em" weight="bold" />
                <span>Grenzstein hinzufügen</span>
              </button>
            {:else}
            <div
              class="relative border border-dashed border-hairline rounded-btn p-4 pr-12 flex flex-col gap-3"
            >
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
                <div
                  class="rounded-btn bg-surface-muted border px-3 py-2 text-xs text-crimson"
                >
                  {stoneError}
                </div>
              {/if}

              {#if stonePreview}
                <img
                  src={stonePreview}
                  alt="Vorschau"
                  class="w-full max-w-[240px] h-auto rounded-btn border self-start"
                />
              {/if}

              <label
                class="inline-flex items-center justify-center gap-2 px-3 py-2 min-h-[44px] rounded-btn bg-surface border text-ink text-sm font-semibold cursor-pointer hover:border-pine transition self-start"
              >
                <Camera size="1em" />
                {stonePreview ? "Anderes Foto" : "Foto auswählen"}
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
                    Standort:
                    <span class="font-mono"
                      >{stoneGps.lat.toFixed(5)}, {stoneGps.lng.toFixed(
                        5
                      )}</span
                    >
                    · ±{stoneGps.acc.toFixed(0)} m
                  {/if}
                </div>
              {/if}

              <AutoTextarea
                bind:value={stoneDescription}
                initialLines={2}
                placeholder="Beschreibung (z. B. Lage, Markierungen)"
              />

              <label
                class="flex items-center gap-2 text-xs text-content cursor-pointer"
              >
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm"
                  bind:checked={stoneCaptureGps}
                />
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
                  {stoneSubmitting ? "Speichern …" : "Hinzufügen"}
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
          </div>

          <!-- Aktionen -->
          <div
            class="flex flex-col gap-2 p-4 rounded-2xl bg-surface border shadow-understory"
          >
            <h3
              class="text-xs font-semibold uppercase tracking-wider text-content-muted m-0"
            >
              Aktionen
            </h3>
            <p class="text-xs text-content-muted m-0">
              Das Löschen entfernt alle zugehörigen Daten unwiderruflich.
            </p>
            <button
              class="inline-flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-btn bg-surface border text-ink text-sm font-semibold hover:border-pine transition"
              onclick={renameActivePlot}
            >
              <PencilSimple size="1em" /> Umbenennen
            </button>
            <button
              class="inline-flex items-center justify-center gap-2 px-4 py-3 min-h-[48px] rounded-btn font-semibold text-sm text-earth border transition hover:-translate-y-px hover:shadow-understory"
              style="background: var(--color-crimson); border-color: color-mix(in srgb, var(--color-crimson) 75%, black);"
              onclick={deleteActivePlot}
            >
              <Trash size="1em" weight="bold" />
              Waldstück löschen
            </button>
          </div>
        </article>
      {/if}

      {#if activeTab === "baeume"}
        <article class="flex flex-col gap-3 animate-rise">
          <header class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0 flex flex-col gap-[2px]">
              <span class="eyebrow">Bäume</span>
              <h2
                class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
                style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
              >
                {treesForActive.length} erfasst
              </h2>
              <p class="text-xs text-content-muted">
                Tippe auf das Kamera-Symbol oben, um einen Baum mit GPS
                aufzunehmen.
              </p>
            </div>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-pill text-ink border bg-surface font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy flex-shrink-0"
              onclick={startPlacement}
            >
              <Crosshair size="1em" />
              Platzieren
            </button>
          </header>

          {#if treesForActive.length === 0}
            <div
              class="rounded-2xl border border-dashed bg-surface-muted px-4 py-6 text-center"
            >
              <p class="text-sm text-content-muted m-0">
                Noch keine Bäume erfasst.
              </p>
            </div>
          {:else}
            <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
              {#each treesForActive as t (t.id)}
                <li
                  class="flex items-center justify-between gap-3 px-3 py-2 rounded-btn border transition"
                  class:bg-surface-muted={!selectedTreeIds[t.id]}
                  style={selectedTreeIds[t.id] ?
                    "background: color-mix(in srgb, var(--color-ember) 14%, var(--color-surface)); border-color: var(--color-rust);"
                  : ""}
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <span
                      class="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style="background: {t.healthStatus === 'healthy' ?
                        '#5d7a4a'
                      : t.healthStatus === 'must-watch' ? '#d4a23c'
                      : t.healthStatus === 'infected' ? '#c76a2b'
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
      {/if}

      {#if activeTab === "bereich"}
        <article class="flex flex-col gap-3 animate-rise">
          <header class="flex items-start justify-between gap-3">
            <div class="flex-1 min-w-0 flex flex-col gap-[2px]">
              <span class="eyebrow">Bereich</span>
              <h2
                class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
                style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
              >
                {areasForActive.length} markiert
              </h2>
              <p class="text-xs text-content-muted">
                Eine Fläche umkreisen — z.B. Sturmschaden oder befallener
                Abschnitt.
              </p>
            </div>
            <button
              class="inline-flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-pill text-earth border font-semibold text-xs shadow-understory hover:-translate-y-px hover:shadow-canopy flex-shrink-0"
              style="background: var(--color-amber); border-color: color-mix(in srgb, var(--color-amber) 70%, black);"
              onclick={startAreaDraw}
            >
              <PolygonIcon size="1em" weight="bold" />
              Zeichnen
            </button>
          </header>

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
                Aufheben
              </button>
            </div>
          {/if}

          {#if areasForActive.length === 0}
            <div
              class="rounded-2xl border border-dashed bg-surface-muted px-4 py-6 text-center"
            >
              <p class="text-sm text-content-muted m-0">
                Noch keine Bereiche markiert.
              </p>
            </div>
          {:else}
            <ul class="flex flex-col gap-1.5 list-none p-0 m-0">
              {#each areasForActive as a, i (a.id)}
                {@const inside = treesInsideArea(a).length}
                <li
                  class="flex items-stretch gap-2 rounded-btn border transition overflow-hidden"
                  class:bg-surface-muted={a.id !== selectedAreaId}
                  style={a.id === selectedAreaId ?
                    "background: color-mix(in srgb, var(--color-ember) 14%, var(--color-surface)); border-color: var(--color-rust);"
                  : ""}
                >
                  <button
                    class="flex-1 min-w-0 flex flex-col items-start gap-0.5 bg-transparent border-0 px-3 py-2 text-left"
                    onclick={() => selectArea(a.id)}
                    aria-pressed={a.id === selectedAreaId}
                  >
                    <div class="flex items-center gap-2 min-w-0 max-w-full">
                      <span
                        class="inline-block w-3 h-3 rounded-sm flex-shrink-0 border"
                        style="background: color-mix(in srgb, #c98f2a 22%, transparent); border-color: #c98f2a;"
                        aria-hidden="true"
                      ></span>
                      <span class="text-sm text-ink font-medium truncate">
                        Bereich {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        class="text-xs text-content-muted whitespace-nowrap"
                      >
                        · {inside}
                        {inside === 1 ? "Baum" : "Bäume"}
                      </span>
                    </div>
                    {#if a.appliedTreeStatus || a.comment}
                      <div
                        class="flex items-center gap-2 mt-0.5 max-w-full min-w-0"
                      >
                        {#if a.appliedTreeStatus}
                          <span
                            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill text-[0.6875rem] font-semibold flex-shrink-0"
                            style="background: {(
                              a.appliedTreeStatus === 'healthy'
                            ) ?
                              '#5d7a4a'
                            : a.appliedTreeStatus === 'must-watch' ? '#d4a23c'
                            : a.appliedTreeStatus === 'infected' ? '#c76a2b'
                            : '#4a4a4a'}; color: #fff;"
                          >
                            {HEALTH_LABELS[
                              a.appliedTreeStatus as keyof typeof HEALTH_LABELS
                            ] ?? a.appliedTreeStatus}
                          </span>
                        {/if}
                        {#if a.comment}
                          <span
                            class="text-xs text-content-muted truncate min-w-0"
                          >
                            {a.comment}
                          </span>
                        {/if}
                      </div>
                    {/if}
                  </button>
                  <button
                    class="w-10 grid place-items-center bg-transparent border-0 border-l text-content-muted hover:text-crimson hover:bg-surface flex-shrink-0"
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
      {/if}
    </section>
  {/if}
</div>
