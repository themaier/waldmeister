<script lang="ts">
  // The persistent MapLibre instance used everywhere. One map, many modes.
  // See README §5.2 — arrow switching and outline clicks pan/zoom on the
  // *same* instance rather than re-mounting, so we expose a small imperative
  // API via `bind:this`.

  import { onMount, onDestroy } from 'svelte';
  import maplibregl from 'maplibre-gl';
  import type { Map as MLMap, LngLatBoundsLike } from 'maplibre-gl';

  interface Props {
    initialCenter?: [number, number];
    initialZoom?: number;
    onClick?: (e: { lng: number; lat: number; originalEvent: MouseEvent }) => void;
    onLongPress?: (e: { lng: number; lat: number }) => void;
    class?: string;
  }

  let {
    initialCenter = [11.5, 48.5], // Bayern, roughly
    initialZoom = 7,
    onClick,
    onLongPress,
    class: klass = ''
  }: Props = $props();

  let containerEl: HTMLDivElement;
  let map = $state<MLMap | null>(null);

  // Base map: BayernAtlas DOP satellite imagery (§6.1). The open-data WMS
  // endpoint is public and CORS-enabled, so MapLibre fetches tiles directly.
  // The URL can be overridden via VITE_BAYERN_WMS_SATELLITE for mirrors or
  // authenticated instances; the default hits the LDBV open-data service.
  const bayernWms =
    import.meta.env.VITE_BAYERN_WMS_SATELLITE ||
    'https://geoservices.bayern.de/od/wms/dop/v1/dop40';
  const rasterSources = {
    base: {
      type: 'raster' as const,
      tiles: [
        // DOP40 advertises WMS 1.1.1 — use srs= (not crs=) and minx,miny,maxx,maxy order.
        `${bayernWms}?service=WMS&request=GetMap&version=1.1.1&layers=by_dop40c&styles=&srs=EPSG:3857&format=image/png&transparent=false&width=256&height=256&bbox={bbox-epsg-3857}`
      ],
      tileSize: 256,
      attribution: '© GeoBasis-DE / BKG / LDBV Bayern'
    }
  };

  onMount(() => {
    map = new maplibregl.Map({
      container: containerEl,
      style: {
        version: 8,
        sources: rasterSources,
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
      },
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: { compact: true }
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showAccuracyCircle: true
      }),
      'top-right'
    );

    // Tap → forward to parent.
    map.on('click', (e) => {
      onClick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat, originalEvent: e.originalEvent });
    });

    // Long-press detection — MapLibre doesn't ship one, so we build it from
    // touchstart + a 500 ms timer cancelled by move/end.
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressLngLat: { lng: number; lat: number } | null = null;
    const PRESS_MS = 550;
    const canvas = map.getCanvasContainer();

    const cancelLongPress = () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      longPressLngLat = null;
    };

    const startLongPress = (clientX: number, clientY: number) => {
      cancelLongPress();
      const rect = canvas.getBoundingClientRect();
      const point = [clientX - rect.left, clientY - rect.top] as [number, number];
      const lngLat = map!.unproject(point);
      longPressLngLat = { lng: lngLat.lng, lat: lngLat.lat };
      longPressTimer = setTimeout(() => {
        if (longPressLngLat) onLongPress?.(longPressLngLat);
        cancelLongPress();
      }, PRESS_MS);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startLongPress(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', cancelLongPress);
    canvas.addEventListener('pointercancel', cancelLongPress);
    canvas.addEventListener('pointerleave', cancelLongPress);
    map.on('movestart', cancelLongPress);
    map.on('zoomstart', cancelLongPress);

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', cancelLongPress);
      canvas.removeEventListener('pointercancel', cancelLongPress);
      canvas.removeEventListener('pointerleave', cancelLongPress);
    };
  });

  onDestroy(() => {
    map?.remove();
    map = null;
  });

  // --- Imperative helpers exposed to parents ---
  export function instance(): MLMap | null {
    return map;
  }
  export function fitBounds(bounds: LngLatBoundsLike, opts: { padding?: number; duration?: number } = {}) {
    map?.fitBounds(bounds, { padding: opts.padding ?? 60, duration: opts.duration ?? 800 });
  }
  export function flyTo(center: [number, number], zoom: number) {
    map?.flyTo({ center, zoom, essential: true });
  }
</script>

<div bind:this={containerEl} class="map-surface {klass}"></div>
