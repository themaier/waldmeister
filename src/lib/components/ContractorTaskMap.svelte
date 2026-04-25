<script lang="ts">
  // Read-only overview map for the contractor share view (/a/[token]).
  // Shows routes + assigned trees/areas, dims every route except the one
  // whose path comes closest to the work targets (the route the contractor
  // is most likely to actually use).
  import maplibregl from 'maplibre-gl';
  import { onMount, onDestroy } from 'svelte';
  import type { HealthStatus } from '$lib/enums';

  type LineString = { type: 'LineString'; coordinates: [number, number][] };
  type MultiLineString = { type: 'MultiLineString'; coordinates: [number, number][][] };
  type Polygon = { type: 'Polygon'; coordinates: [number, number][][] };

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
  }
  interface AreaInput {
    id: string;
    geometry: Polygon | unknown;
  }

  interface Props {
    routes: RouteInput[];
    trees: TreeInput[];
    areas: AreaInput[];
    /** Restrict highlighted area set; if null, every passed area is highlighted. */
    highlightedAreaIds?: string[] | null;
    class?: string;
  }

  let { routes, trees, areas, highlightedAreaIds = null, class: klass = '' }: Props = $props();

  let containerEl: HTMLDivElement;
  let map: maplibregl.Map | null = null;

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
    const pts: [number, number][] = trees.map((t) => [t.longitude, t.latitude]);
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

  function buildBounds(): maplibregl.LngLatBounds | null {
    const b = new maplibregl.LngLatBounds();
    let any = false;
    for (const t of trees) { b.extend([t.longitude, t.latitude]); any = true; }
    for (const r of routes) for (const c of flattenLine(r.pathData)) { b.extend(c); any = true; }
    for (const a of areas) {
      const g = a.geometry as Polygon | undefined;
      if (!g || g.type !== 'Polygon') continue;
      for (const ring of g.coordinates) for (const c of ring) { b.extend(c); any = true; }
    }
    return any ? b : null;
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

    // Trees — coloured by health.
    map.addSource('task-trees', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: trees.map((t) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [t.longitude, t.latitude] },
          properties: { id: t.id, health: t.healthStatus ?? 'healthy' }
        }))
      }
    });
    map.addLayer({
      id: 'task-trees-circles',
      type: 'circle',
      source: 'task-trees',
      paint: {
        'circle-radius': 6,
        'circle-color': [
          'match',
          ['get', 'health'],
          'healthy', getCss('--health-healthy', '#15803d'),
          'must-watch', getCss('--health-must-watch', '#ca8a04'),
          'infected', getCss('--health-infected', '#b45309'),
          'dead', getCss('--health-dead', '#7f1d1d'),
          '#15803d'
        ],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 1.5
      }
    });
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

    const bounds = buildBounds();
    map = new maplibregl.Map({
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
        ]
      },
      center: bounds ? bounds.getCenter().toArray() as [number, number] : [11.5, 48.5],
      zoom: 14,
      maxZoom: 19,
      attributionControl: false
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showAccuracyCircle: true
      }),
      'top-right'
    );

    map.on('load', () => {
      addLayers();
      if (bounds) map!.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 18 });
    });
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });
</script>

<div bind:this={containerEl} class="map-surface w-full h-[55vh] min-h-[320px] rounded-btn overflow-hidden border {klass}"></div>
