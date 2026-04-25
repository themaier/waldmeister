<script lang="ts">
  // Bereich freehand drawing tool — README §4.5.
  //
  // Behaves like RouteDrawTool but produces a *closed* polygon: when the
  // finger lifts, the start and end points are connected automatically. The
  // tool fires `onComplete` with a GeoJSON Polygon and unmounts itself; the
  // parent decides whether to persist it and what to do with the trees that
  // fall inside.
  import maplibregl from 'maplibre-gl';
  import { X } from 'phosphor-svelte';

  interface Props {
    mlMap: maplibregl.Map;
    onCancel: () => void;
    onComplete: (polygon: {
      type: 'Polygon';
      coordinates: [number, number][][];
    }) => void;
  }

  let { mlMap, onCancel, onComplete }: Props = $props();

  let path = $state<[number, number][]>([]);
  let saving = $state(false);

  const SOURCE_ID = 'area-draft';
  const FILL_LAYER_ID = 'area-draft-fill';
  const LINE_LAYER_ID = 'area-draft-line';

  function ensureLayer() {
    if (mlMap.getSource(SOURCE_ID)) return;
    mlMap.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });
    mlMap.addLayer({
      id: FILL_LAYER_ID,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': '#d4a23c',
        'fill-opacity': 0.18
      }
    });
    mlMap.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': '#c98f2a',
        'line-width': 3,
        'line-opacity': 0.95
      }
    });
  }

  function previewFeature(closed: boolean) {
    if (path.length < 2) return null;
    if (closed && path.length >= 3) {
      const ring = [...path, path[0]];
      return {
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Polygon' as const, coordinates: [ring] }
      };
    }
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: path }
    };
  }

  function updatePreview(closed: boolean) {
    const src = mlMap.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const f = previewFeature(closed);
    src.setData({ type: 'FeatureCollection', features: f ? [f] : [] });
  }

  function clearPreview() {
    if (mlMap.getLayer(LINE_LAYER_ID)) mlMap.removeLayer(LINE_LAYER_ID);
    if (mlMap.getLayer(FILL_LAYER_ID)) mlMap.removeLayer(FILL_LAYER_ID);
    if (mlMap.getSource(SOURCE_ID)) mlMap.removeSource(SOURCE_ID);
  }

  let drawing = false;
  let canvas: HTMLElement | null = null;

  function pointToLngLat(clientX: number, clientY: number): [number, number] {
    const rect = canvas!.getBoundingClientRect();
    const ll = mlMap.unproject([clientX - rect.left, clientY - rect.top]);
    return [ll.lng, ll.lat];
  }

  function pixelDistanceFromLast(clientX: number, clientY: number): number {
    if (path.length === 0 || !canvas) return Infinity;
    const last = mlMap.project(path[path.length - 1]);
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - rect.left - last.x;
    const dy = clientY - rect.top - last.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function onPointerDown(e: PointerEvent) {
    if (saving) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drawing = true;
    try {
      canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported in some browsers — ignore */
    }
    path = [pointToLngLat(e.clientX, e.clientY)];
    updatePreview(false);
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing) return;
    if (pixelDistanceFromLast(e.clientX, e.clientY) < 2) return;
    path = [...path, pointToLngLat(e.clientX, e.clientY)];
    updatePreview(false);
    e.preventDefault();
  }

  function onPointerUp(e: PointerEvent) {
    if (!drawing) return;
    drawing = false;
    try {
      canvas?.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (path.length < 3) {
      // Tap/scribble too short to form an area — reset and let the user try
      // again without dropping the tool.
      path = [];
      updatePreview(false);
      return;
    }
    saving = true;
    updatePreview(true);
    onComplete({ type: 'Polygon', coordinates: [[...path, path[0]]] });
  }

  $effect(() => {
    canvas = mlMap.getCanvasContainer();
    ensureLayer();
    const handlers = [
      mlMap.dragPan,
      mlMap.scrollZoom,
      mlMap.doubleClickZoom,
      mlMap.touchZoomRotate,
      mlMap.boxZoom,
      mlMap.dragRotate
    ];
    for (const h of handlers) h.disable();

    // See RouteDrawTool — the canvas container's `touch-action` lets the
    // browser claim touch gestures and fires `pointercancel` after one event.
    // Disable it while the tool is mounted so the freehand stroke flows.
    const prevTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas?.removeEventListener('pointerdown', onPointerDown);
      canvas?.removeEventListener('pointermove', onPointerMove);
      canvas?.removeEventListener('pointerup', onPointerUp);
      canvas?.removeEventListener('pointercancel', onPointerUp);
      if (canvas) canvas.style.touchAction = prevTouchAction;
      for (const h of handlers) h.enable();
      clearPreview();
    };
  });
</script>

<div
  class="absolute left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-3 pl-4 pr-2 py-2 rounded-pill text-earth font-medium text-sm shadow-canopy animate-rise pointer-events-auto"
  style="top: calc(0.75rem + env(safe-area-inset-top)); background: var(--color-pine-deep);"
>
  <span class="w-2 h-2 rounded-full bg-ember animate-breathe"></span>
  <span>
    {saving ? 'Bereich wird gespeichert…' : 'Bereich mit dem Finger umranden'}
  </span>
  <button
    class="w-7 h-7 min-h-0 grid place-items-center rounded-full text-earth border-0"
    style="background: color-mix(in srgb, var(--color-earth) 14%, transparent);"
    onclick={onCancel}
    disabled={saving}
    aria-label="Abbrechen"
  >
    <X size="0.9em" weight="bold" />
  </button>
</div>
