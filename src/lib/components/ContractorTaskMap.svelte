<script lang="ts">
  // Read-only overview map: contractor share (/a/[token]) and owner Auftrag detail (/auftraege/[id]).
  // Shows routes + assigned trees/areas, dims every route except the one
  // whose path comes closest to the work targets (the route the contractor
  // is most likely to actually use).
  import maplibregl from 'maplibre-gl';
  import { onMount, onDestroy } from 'svelte';
  import type { HealthStatus } from '$lib/enums';

  type AssignmentStatus = 'OPEN' | 'COMPLETED' | 'NOT_FOUND' | 'PROBLEM';

  type LineString = { type: 'LineString'; coordinates: [number, number][] };
  type MultiLineString = { type: 'MultiLineString'; coordinates: [number, number][][] };
  type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };
  type MultiPolygon = { type: 'MultiPolygon'; coordinates: [number, number][][][] };

  interface RouteInput {
    id: string;
    routeType: 'anfahrt' | 'rueckegasse';
    name: string | null;
    pathData: LineString | MultiLineString | unknown;
  }
  interface TreeInput {
    id: string;
    latitude: number;
    longitude: number;
    healthStatus: HealthStatus | null;
    /** Per-assignment status — marker colour follows this (not only health). */
    status: AssignmentStatus;
  }
  interface AreaInput {
    id: string;
    geometry: Polygon | unknown;
  }

  interface ForestParcelInput {
    geometry: Polygon | MultiPolygon;
  }

  interface Props {
    routes: RouteInput[];
    trees: TreeInput[];
    areas: AreaInput[];
    /** Flurstück geometries for the Waldstück — used to frame the full forest. */
    forestParcels?: ForestParcelInput[];
    /** Point guaranteed inside the Waldstück (PostGIS point-on-surface). */
    forestCenter?: [number, number] | null;
    /** Restrict highlighted area set; if null, every passed area is highlighted. */
    highlightedAreaIds?: string[] | null;
    class?: string;
  }

  let {
    routes,
    trees,
    areas,
    forestParcels = [],
    forestCenter = null,
    highlightedAreaIds = null,
    class: klass = ''
  }: Props = $props();

  let containerEl: HTMLDivElement;
  let map = $state<maplibregl.Map | null>(null);
  /** True after `load` added sources/layers — tree `$effect` must not run before this. */
  let mapStyleReady = $state(false);
  /**
   * Camera framing: Waldstück parcels + Bäume/Bereiche.
   * When Flurstück outlines exist, Anfahrts-Linien are excluded so a long route
   * does not shove the Waldstück to the edge of the viewport.
   */
  let framingBounds: maplibregl.LngLatBounds | null = null;

  /** Extra right inset — Navigation + Geolocate stack on `top-right`. */
  const FIT_PADDING = { top: 48, bottom: 48, left: 48, right: 100 } as const;

  /** Bäume with usable WGS84 coords (DB / JSON can surface strings or null). */
  function treesOnMap(): TreeInput[] {
    const out: TreeInput[] = [];
    for (const t of trees) {
      const lat = Number(t.latitude);
      const lng = Number(t.longitude);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        continue;
      }
      out.push({
        id: t.id,
        latitude: lat,
        longitude: lng,
        healthStatus: t.healthStatus,
        status: t.status
      });
    }
    return out;
  }

  function flattenLine(p: unknown): [number, number][] {
    if (!p || typeof p !== 'object') return [];
    const o = p as { type?: string; coordinates?: unknown };
    if (o.type === 'LineString' && Array.isArray(o.coordinates)) {
      return o.coordinates as [number, number][];
    }
    if (o.type === 'MultiLineString' && Array.isArray(o.coordinates)) {
      return (o.coordinates as [number, number][][]).flat();
    }
    return [];
  }

  function distSq(a: [number, number], b: [number, number]): number {
    // Equirectangular approximation — distances are tiny relative to lat/lng,
    // so cos(lat) scaling on x is enough to make comparisons fair.
    const cos = Math.cos((a[1] * Math.PI) / 180);
    const dx = (a[0] - b[0]) * cos;
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  }

  function targetPoints(): [number, number][] {
    const pts: [number, number][] = treesOnMap().map((t) => [t.longitude, t.latitude]);
    for (const a of areas) {
      const g = a.geometry as Polygon | undefined;
      if (!g || g.type !== 'Polygon' || !g.coordinates?.[0]?.length) continue;
      const ring = g.coordinates[0];
      let sx = 0, sy = 0;
      for (const c of ring) { sx += c[0]; sy += c[1]; }
      pts.push([sx / ring.length, sy / ring.length]);
    }
    return pts;
  }

  function pickClosestRouteId(): string | null {
    if (routes.length === 0) return null;
    const targets = targetPoints();
    if (targets.length === 0) return routes[0].id;
    let best: { id: string; d: number } | null = null;
    for (const r of routes) {
      const pts = flattenLine(r.pathData);
      if (pts.length === 0) continue;
      let min = Infinity;
      for (const p of pts) for (const t of targets) {
        const d = distSq(p, t);
        if (d < min) min = d;
      }
      if (best === null || min < best.d) best = { id: r.id, d: min };
    }
    return best?.id ?? null;
  }

  function extendBoundsWithSurface(
    b: maplibregl.LngLatBounds,
    g: Polygon | MultiPolygon | undefined
  ): boolean {
    if (!g) return false;
    let any = false;
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) for (const c of ring) {
        b.extend(c as [number, number]);
        any = true;
      }
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) for (const c of ring) {
        b.extend(c as [number, number]);
        any = true;
      }
    }
    return any;
  }

  function buildFramingBounds(): maplibregl.LngLatBounds | null {
    const b = new maplibregl.LngLatBounds();
    let any = false;
    let hasForestOutline = false;
    for (const p of forestParcels) {
      if (extendBoundsWithSurface(b, p.geometry)) {
        any = true;
        hasForestOutline = true;
      }
    }
    for (const t of treesOnMap()) {
      b.extend([t.longitude, t.latitude]);
      any = true;
    }
    for (const a of areas) {
      const g = a.geometry as Polygon | undefined;
      if (!g || g.type !== 'Polygon') continue;
      for (const ring of g.coordinates) for (const c of ring) {
        b.extend(c);
        any = true;
      }
    }
    if (!hasForestOutline) {
      for (const r of routes) for (const c of flattenLine(r.pathData)) {
        b.extend(c);
        any = true;
      }
    }
    return any ? b : null;
  }

  function applyFramingFit(duration: number) {
    if (!map || !framingBounds) return;
    map.resize();
    map.fitBounds(framingBounds, { padding: FIT_PADDING, duration, maxZoom: 18 });
  }

  function buildForestFeatureCollection() {
    return {
      type: 'FeatureCollection' as const,
      features: forestParcels.map((p, i) => ({
        type: 'Feature' as const,
        id: i,
        geometry: p.geometry,
        properties: {}
      }))
    };
  }

  /** Waldstück Flurstücke: subtle fill under work layers, strong outline on top (readable on DOP). */
  function addForestParcelLayers() {
    if (!map || forestParcels.length === 0) return;
    if (map.getSource('forest-parcels')) return;

    map.addSource('forest-parcels', {
      type: 'geojson',
      data: buildForestFeatureCollection()
    });
    map.addLayer({
      id: 'forest-parcels-fill',
      type: 'fill',
      source: 'forest-parcels',
      paint: {
        'fill-color': '#0f4c2c',
        'fill-opacity': 0.15
      }
    });
  }

  function addForestParcelOutlineOnTop() {
    if (!map || !map.getSource('forest-parcels')) return;
    if (map.getLayer('forest-parcels-outline')) return;
    map.addLayer({
      id: 'forest-parcels-outline',
      type: 'line',
      source: 'forest-parcels',
      paint: {
        'line-color': '#f97316',
        'line-width': 4,
        'line-opacity': 0.95
      }
    });
  }

  function buildTreeCollection() {
    const list = treesOnMap();
    return {
      type: 'FeatureCollection' as const,
      features: list.map((t, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [t.longitude, t.latitude] },
        properties: {
          id: t.id,
          health: t.healthStatus ?? 'healthy',
          status: t.status,
          label: String(i + 1).padStart(2, '0')
        }
      }))
    };
  }

  function syncTaskTreesSource() {
    const m = map;
    if (!m) return;
    const src = m.getSource('task-trees') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildTreeCollection());
  }

  /** OPEN → health; otherwise → assignment status (README §6.6). */
  function treeCircleColorExpression(): maplibregl.ExpressionSpecification {
    const byHealth: maplibregl.ExpressionSpecification = [
      'match',
      ['get', 'health'],
      'healthy',
      getCss('--health-healthy', '#5d7a4a'),
      'must-watch',
      getCss('--health-must-watch', '#d97706'),
      'infected',
      getCss('--health-infected', '#b45309'),
      'dead',
      getCss('--health-dead', '#78716c'),
      getCss('--health-healthy', '#5d7a4a')
    ];
    return [
      'case',
      ['==', ['get', 'status'], 'COMPLETED'],
      getCss('--color-pine-deep', '#0f4c2c'),
      ['==', ['get', 'status'], 'PROBLEM'],
      getCss('--color-amber', '#d97706'),
      ['==', ['get', 'status'], 'NOT_FOUND'],
      getCss('--color-stone', '#78716c'),
      byHealth
    ];
  }

  function addLayers() {
    if (!map) return;
    const closestRouteId = pickClosestRouteId();
    const highlightedAreaSet = new Set(highlightedAreaIds ?? areas.map((a) => a.id));

    // Areas — soft fill. Highlighted area (if any) gets a stronger outline.
    map.addSource('task-areas', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: areas
          .filter((a) => {
            const g = a.geometry as Polygon | undefined;
            return g && g.type === 'Polygon';
          })
          .map((a) => ({
            type: 'Feature',
            geometry: a.geometry as Polygon,
            properties: { id: a.id, highlight: highlightedAreaSet.has(a.id) }
          }))
      }
    });
    map.addLayer({
      id: 'task-areas-fill',
      type: 'fill',
      source: 'task-areas',
      paint: {
        'fill-color': '#f59e0b',
        'fill-opacity': ['case', ['get', 'highlight'], 0.28, 0.08]
      }
    });
    map.addLayer({
      id: 'task-areas-outline',
      type: 'line',
      source: 'task-areas',
      paint: {
        'line-color': '#b45309',
        'line-width': ['case', ['get', 'highlight'], 2.5, 1],
        'line-opacity': ['case', ['get', 'highlight'], 0.95, 0.35]
      }
    });

    // Routes — split into dim and highlighted layers driven by `closest` flag.
    map.addSource('task-routes', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: routes
          .filter((r) => flattenLine(r.pathData).length > 0)
          .map((r) => ({
            type: 'Feature',
            geometry: r.pathData as LineString | MultiLineString,
            properties: {
              id: r.id,
              closest: r.id === closestRouteId,
              kind: r.routeType
            }
          }))
      }
    });
    // Dim layer first so the highlight draws on top.
    map.addLayer({
      id: 'task-routes-dim',
      type: 'line',
      source: 'task-routes',
      filter: ['!', ['get', 'closest']],
      paint: {
        'line-color': '#94a3b8',
        'line-width': 3,
        'line-opacity': 0.35
      }
    });
    map.addLayer({
      id: 'task-routes-hi',
      type: 'line',
      source: 'task-routes',
      filter: ['get', 'closest'],
      paint: {
        // Anfahrt = pine, Rückegasse = ember — both stand out against the dim grey.
        'line-color': ['match', ['get', 'kind'], 'rueckegasse', '#c2410c', '#15803d'],
        'line-width': 5,
        'line-opacity': 0.95
      }
    });

    // Trees — numbered, coloured by assignment status (OPEN still uses health).
    map.addSource('task-trees', { type: 'geojson', data: buildTreeCollection() });
    map.addLayer({
      id: 'task-trees-circles',
      type: 'circle',
      source: 'task-trees',
      paint: {
        'circle-radius': 9,
        'circle-color': treeCircleColorExpression(),
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2
      }
    });
    // Glyphs must exist on `glyphs` URL — Semibold stack often 404s on demotiles; a bad symbol layer can break the style.
    try {
      map.addLayer({
        id: 'task-trees-labels',
        type: 'symbol',
        source: 'task-trees',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
          'text-allow-overlap': true,
          'text-ignore-placement': true
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.55)',
          'text-halo-width': 1.25
        }
      });
    } catch {
      /* numbered labels optional */
    }
  }

  function getCss(name: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  onMount(() => {
    const dopTiles = [1, 2, 3].map(
      (i) => `https://wmtsod${i}.bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}`
    );
    const labelTiles = [1, 2, 3].map(
      (i) => `https://wmtsod${i}.bayernwolke.de/wmts/by_label/smerc/{z}/{x}/{y}`
    );

    framingBounds = buildFramingBounds();
    const instance = new maplibregl.Map({
      container: containerEl,
      style: {
        version: 8,
        sources: {
          base: {
            type: 'raster',
            tiles: dopTiles,
            tileSize: 256,
            maxzoom: 19,
            attribution: '© GeoBasis-DE / BKG / LDBV Bayern'
          },
          parzellarkarte: {
            type: 'raster',
            tiles: labelTiles,
            tileSize: 256,
            maxzoom: 19,
            attribution: '© LDBV Bayern — ALKIS-Parzellarkarte (CC BY-ND 4.0)'
          }
        },
        layers: [
          { id: 'base', type: 'raster', source: 'base' },
          { id: 'parzellarkarte', type: 'raster', source: 'parzellarkarte' }
        ],
        // Same as `Map.svelte` — required for tree index labels on the symbol layer.
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
      },
      center: framingBounds
        ? (framingBounds.getCenter().toArray() as [number, number])
        : [11.5, 48.5],
      zoom: 14,
      maxZoom: 19,
      attributionControl: false
    });
    map = instance;
    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    instance.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showAccuracyCircle: true
      }),
      'top-right'
    );

    instance.on('load', () => {
      addForestParcelLayers();
      addLayers();
      addForestParcelOutlineOnTop();
      mapStyleReady = true;
      syncTaskTreesSource();
      applyFramingFit(0);
      // Container size can be wrong until layout + first tiles; refit once stable.
      instance.once('idle', () => applyFramingFit(0));
    });
  });

  onDestroy(() => {
    map?.remove();
    map = null;
    mapStyleReady = false;
  });

  $effect(() => {
    // Re-sync when revalidated page data changes (e.g. contractor marks a tree).
    trees;
    if (!mapStyleReady) return;
    syncTaskTreesSource();
  });

  $effect(() => {
    forestParcels;
    mapStyleReady;
    if (!mapStyleReady) return;
    const src = map?.getSource('forest-parcels') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildForestFeatureCollection());
  });

  export function fitForestView() {
    if (!map) return;
    if (forestCenter) {
      map.resize();
      map.easeTo({
        center: forestCenter,
        zoom: Math.max(map.getZoom(), 16),
        duration: 650,
        padding: FIT_PADDING
      });
      return;
    }
    applyFramingFit(550);
  }
</script>

<div bind:this={containerEl} class="map-surface w-full h-[55vh] min-h-[320px] rounded-btn overflow-hidden border {klass}"></div>
