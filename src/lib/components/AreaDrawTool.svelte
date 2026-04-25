<script lang="ts">
  // Bereich freehand drawing tool — README §4.5 / §5.8.
  //
  // Two-phase lifecycle, mirroring RouteDrawTool:
  //   1. drawing — finger drags an outline on the map. On finger-up the
  //                shape auto-closes into a polygon.
  //   2. form    — bottom sheet asks for Kommentar + Baumstatus. The
  //                polygon stays rendered on the map underneath. The user
  //                can Speichern, Wiederholen (back to phase 1), or
  //                Abbrechen.
  //
  // Trees inside the freshly drawn polygon are counted live with a simple
  // ray-casting point-in-polygon so we can show "Wird auf N Bäume
  // angewendet" before submit.
  import maplibregl from 'maplibre-gl';
  import { X, Check, ArrowCounterClockwise } from 'phosphor-svelte';
  import { HEALTH_STATUSES, HEALTH_LABELS, HEALTH_COLORS, type HealthStatus } from '$lib/enums';

  interface TreePoint {
    id: string;
    latitude: string | number;
    longitude: string | number;
  }

  interface Props {
    mlMap: maplibregl.Map;
    trees: TreePoint[];
    onCancel: () => void;
    onComplete: (input: {
      geometry: { type: 'Polygon'; coordinates: [number, number][][] };
      comment: string | null;
      appliedTreeStatus: HealthStatus | null;
    }) => Promise<void>;
  }

  let { mlMap, trees, onCancel, onComplete }: Props = $props();

  type Phase = 'drawing' | 'form' | 'saving';
  let phase = $state<Phase>('drawing');
  let path = $state<[number, number][]>([]);
  let comment = $state('');
  let appliedStatus = $state<HealthStatus | null>(null);
  let saveError = $state<string | null>(null);

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

  // --- Trees-in-polygon (client-side, ray casting) -----------------------
  function pointInRing(pt: [number, number], ring: [number, number][]): boolean {
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
  const treesInside = $derived.by(() => {
    if (path.length < 3) return 0;
    let count = 0;
    for (const t of trees) {
      const pt: [number, number] = [Number(t.longitude), Number(t.latitude)];
      if (pointInRing(pt, path)) count++;
    }
    return count;
  });

  // --- Pointer plumbing --------------------------------------------------
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
    if (phase !== 'drawing') return;
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
    e.stopPropagation();
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing) return;
    if (pixelDistanceFromLast(e.clientX, e.clientY) < 2) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    path = [...path, pointToLngLat(e.clientX, e.clientY)];
    updatePreview(false);
    e.preventDefault();
    e.stopPropagation();
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
      // Tap/scribble too short — reset and stay in drawing mode.
      path = [];
      updatePreview(false);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    updatePreview(true);
    phase = 'form';
    e.preventDefault();
    e.stopPropagation();
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

    const innerCanvas = mlMap.getCanvas();
    const prevTouchAction = canvas.style.touchAction;
    const prevTouchActionInner = innerCanvas?.style.touchAction ?? '';
    const prevOverscroll = canvas.style.overscrollBehavior;
    const prevOverscrollInner = innerCanvas?.style.overscrollBehavior ?? '';
    canvas.style.touchAction = 'none';
    canvas.style.overscrollBehavior = 'none';
    if (innerCanvas) {
      innerCanvas.style.touchAction = 'none';
      innerCanvas.style.overscrollBehavior = 'none';
    }

    const ptrOpts: AddEventListenerOptions = { capture: true, passive: false };
    canvas.addEventListener('pointerdown', onPointerDown, ptrOpts);
    canvas.addEventListener('pointermove', onPointerMove, ptrOpts);
    canvas.addEventListener('pointerup', onPointerUp, ptrOpts);
    canvas.addEventListener('pointercancel', onPointerUp, ptrOpts);

    return () => {
      canvas?.removeEventListener('pointerdown', onPointerDown, ptrOpts);
      canvas?.removeEventListener('pointermove', onPointerMove, ptrOpts);
      canvas?.removeEventListener('pointerup', onPointerUp, ptrOpts);
      canvas?.removeEventListener('pointercancel', onPointerUp, ptrOpts);
      if (canvas) {
        canvas.style.touchAction = prevTouchAction;
        canvas.style.overscrollBehavior = prevOverscroll;
      }
      if (innerCanvas) {
        innerCanvas.style.touchAction = prevTouchActionInner;
        innerCanvas.style.overscrollBehavior = prevOverscrollInner;
      }
      for (const h of handlers) h.enable();
      clearPreview();
    };
  });

  function redo() {
    path = [];
    saveError = null;
    updatePreview(false);
    phase = 'drawing';
  }

  async function submit() {
    if (path.length < 3) return;
    saveError = null;
    phase = 'saving';
    try {
      await onComplete({
        geometry: { type: 'Polygon', coordinates: [[...path, path[0]]] },
        comment: comment.trim() || null,
        appliedTreeStatus: appliedStatus
      });
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Speichern fehlgeschlagen.';
      phase = 'form';
    }
  }
</script>

{#if phase === 'drawing'}
  <div
    class="absolute left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-3 pl-4 pr-2 py-2 rounded-pill text-earth font-medium text-sm shadow-canopy animate-rise pointer-events-auto max-w-[calc(100vw-1.5rem)]"
    style="top: calc(0.75rem + env(safe-area-inset-top)); background: var(--color-pine-deep);"
  >
    <span class="w-2 h-2 rounded-full bg-ember animate-breathe flex-shrink-0"></span>
    <span class="truncate">Bereich mit dem Finger umranden</span>
    <button
      class="w-7 h-7 min-h-0 min-w-0 grid place-items-center rounded-full text-earth border-0 flex-shrink-0"
      style="background: color-mix(in srgb, var(--color-earth) 14%, transparent);"
      onclick={onCancel}
      aria-label="Abbrechen"
    >
      <X size="0.9em" weight="bold" />
    </button>
  </div>
{/if}

{#if phase === 'form' || phase === 'saving'}
  <div
    class="absolute inset-0 z-30 pointer-events-auto"
    style="background: color-mix(in srgb, var(--color-ink) 22%, transparent);"
    aria-hidden="true"
  ></div>

  <div
    class="absolute inset-x-0 bottom-0 z-40 pointer-events-auto animate-rise"
    style="padding-bottom: env(safe-area-inset-bottom);"
  >
    <div
      class="mx-auto max-w-[28rem] bg-surface border-t border rounded-t-2xl shadow-canopy p-5 flex flex-col gap-4"
    >
      <div class="flex items-start gap-3">
        <div class="flex-1 flex flex-col gap-[2px] min-w-0">
          <span class="eyebrow">Bereich-Details</span>
          <h2
            class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
            style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
          >
            Neuer Bereich
          </h2>
          <p class="text-xs text-content-muted mt-0.5">
            {treesInside}
            {treesInside === 1 ? 'Baum' : 'Bäume'} im umrandeten Bereich
          </p>
        </div>
        <button
          class="w-9 h-9 min-h-0 min-w-0 grid place-items-center rounded-full bg-transparent border text-content-muted hover:text-ink hover:border-pine flex-shrink-0"
          onclick={onCancel}
          disabled={phase === 'saving'}
          aria-label="Abbrechen"
        >
          <X size="1em" weight="bold" />
        </button>
      </div>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-semibold text-ink"
          >Kommentar <span class="text-content-muted font-normal">(optional)</span></span
        >
        <textarea
          class="px-3 py-2.5 min-h-[72px] rounded-btn bg-earth border text-ink text-sm focus:outline-none focus:border-pine resize-y"
          placeholder="z.B. Sturmschaden März 2026, Befallener Abschnitt"
          maxlength="2000"
          rows="2"
          bind:value={comment}
          disabled={phase === 'saving'}
        ></textarea>
      </label>

      <fieldset class="flex flex-col gap-1.5 text-sm" disabled={phase === 'saving'}>
        <legend class="font-semibold text-ink mb-1">
          Baumstatus anwenden
          <span class="text-content-muted font-normal">(optional)</span>
        </legend>
        <div class="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-1.5 px-2 py-2 min-h-[40px] rounded-btn border text-sm font-medium transition"
            class:bg-surface={appliedStatus !== null}
            class:text-content={appliedStatus !== null}
            style={appliedStatus === null
              ? 'background: var(--color-pine); color: var(--color-earth); border-color: var(--color-pine-dark);'
              : ''}
            aria-pressed={appliedStatus === null}
            onclick={() => (appliedStatus = null)}
          >
            Kein Status
          </button>
          {#each HEALTH_STATUSES as s}
            <button
              type="button"
              class="inline-flex items-center justify-center gap-1.5 px-2 py-2 min-h-[40px] rounded-btn border text-sm font-medium transition"
              class:bg-surface={appliedStatus !== s}
              class:text-content={appliedStatus !== s}
              style={appliedStatus === s
                ? `background: ${HEALTH_COLORS[s]}; color: #fff; border-color: color-mix(in srgb, ${HEALTH_COLORS[s]} 70%, black);`
                : ''}
              aria-pressed={appliedStatus === s}
              onclick={() => (appliedStatus = s)}
            >
              <span
                class="inline-block w-2.5 h-2.5 rounded-full"
                style="background: {HEALTH_COLORS[s]};"
                aria-hidden="true"
              ></span>
              {HEALTH_LABELS[s]}
            </button>
          {/each}
        </div>
        {#if appliedStatus}
          <p class="text-xs text-content-muted leading-relaxed mt-1">
            Wird auf <strong>{treesInside}</strong>
            {treesInside === 1 ? 'Baum' : 'Bäume'} in diesem Bereich angewendet.
          </p>
        {/if}
      </fieldset>

      {#if saveError}
        <p class="text-sm text-crimson">{saveError}</p>
      {/if}

      <div class="flex gap-2 justify-between items-center pt-1">
        <button
          class="inline-flex items-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-pill bg-transparent border-0 text-content font-semibold text-sm hover:bg-surface-muted disabled:opacity-50"
          onclick={redo}
          disabled={phase === 'saving'}
        >
          <ArrowCounterClockwise size="1em" weight="bold" />
          Wiederholen
        </button>
        <div class="flex gap-2">
          <button
            class="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] rounded-pill bg-transparent border text-ink font-semibold text-sm hover:border-pine"
            onclick={onCancel}
            disabled={phase === 'saving'}
          >
            Abbrechen
          </button>
          <button
            class="inline-flex items-center justify-center px-5 py-2.5 min-h-[44px] rounded-pill text-earth border font-semibold text-sm shadow-understory disabled:opacity-60"
            style="background: var(--color-pine); border-color: color-mix(in srgb, var(--color-pine) 70%, black);"
            onclick={submit}
            disabled={phase === 'saving'}
          >
            <Check size="1em" weight="bold" />
            {phase === 'saving' ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}
