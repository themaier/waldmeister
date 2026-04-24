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

  // BayernAtlas via WMTS (§6.1). The open-data WMTS at bayernwolke.de is
  // CDN-cached, daily-refreshed, and CORS-open (`*`) — much snappier than
  // the on-demand WMS. We use:
  //   - `by_dop`   = DOP satellite imagery (JPEG tiles)
  //   - `by_label` = labels + ALKIS-Parzellarkarte (incl. Flurstücksnummern)
  //                  at higher zoom levels, rendered as a transparent PNG
  //                  overlay on top of the satellite base.
  // Subdomain rotation (1–3) spreads requests across the tile cluster.
  const dopTiles = [1, 2, 3].map(
    (i) => `https://wmtsod${i}.bayernwolke.de/wmts/by_dop/smerc/{z}/{x}/{y}`
  );
  const labelTiles = [1, 2, 3].map(
    (i) => `https://wmtsod${i}.bayernwolke.de/wmts/by_label/smerc/{z}/{x}/{y}`
  );

  // bayernwolke's smerc matrix set tops out at zoom 19 — requesting z=20+
  // yields HTTP 400. Capping `maxzoom` makes MapLibre over-zoom from 19
  // (stretching the last level's pixels) instead of issuing 400s.
  const rasterSources = {
    base: {
      type: 'raster' as const,
      tiles: dopTiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: '© GeoBasis-DE / BKG / LDBV Bayern'
    },
    parzellarkarte: {
      type: 'raster' as const,
      tiles: labelTiles,
      tileSize: 256,
      maxzoom: 19,
      attribution: '© LDBV Bayern — ALKIS-Parzellarkarte (CC BY-ND 4.0)'
    }
  };

  onMount(() => {
    map = new maplibregl.Map({
      container: containerEl,
      style: {
        version: 8,
        sources: rasterSources,
        // The Parzellarkarte+labels overlay sits on top of the DOP base so
        // Flurstück outlines and Flurstücksnummern are always visible at
        // higher zoom levels per §5.2/§6.1. The label layer is transparent
        // at low zoom, so leaving it on everywhere is cheap — no minzoom
        // gate needed. Downstream layers (parcels, trees, routes) are
        // inserted above both by the pages that own them.
        layers: [
          { id: 'base', type: 'raster', source: 'base' },
          { id: 'parzellarkarte', type: 'raster', source: 'parzellarkarte' }
        ],
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
      },
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 19,
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
