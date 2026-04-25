<script lang="ts">
  // Anfahrt / Rückegasse freehand drawing tool — README §5.4.
  //
  // Lifecycle:
  //   1. drawing  — freehand strokes; each lift commits a segment; you can
  //                 add more without a separate "continue" step, or
  //                 "Wiederholen" / "Übernehmen" from the bottom bar.
  //   2. form     — bottom-sheet asks for Typ / Name / Gerät / Kommentar.
  //   3. saving   — submitting to the server; sheet stays open.
  //
  // The component manages a temporary `route-draft` GeoJSON layer on the
  // shared MapLibre instance so the line is visible *under* this overlay.
  // On unmount, it cleans the layer and re-enables map gestures.
  import maplibregl from "maplibre-gl";
  import { untrack } from "svelte";
  import { X, Check, ArrowCounterClockwise } from "phosphor-svelte";
  import {
    ROUTE_TYPE_LABELS,
    type RouteType,
    type VehicleType,
  } from "$lib/enums";

  interface Props {
    mlMap: maplibregl.Map;
    initialType: RouteType;
    onCancel: () => void;
    onSave: (data: {
      routeType: RouteType;
      vehicleType: VehicleType;
      name: string | null;
      comment: string | null;
      pathData:
        | { type: "LineString"; coordinates: [number, number][] }
        | { type: "MultiLineString"; coordinates: [number, number][][] };
    }) => Promise<void>;
  }

  let { mlMap, initialType, onCancel, onSave }: Props = $props();

  type Phase = "drawing" | "form" | "saving";
  let phase = $state<Phase>("drawing");
  // Local form fields seeded from the prop once, then edited locally — see
  // CLAUDE.md ("Default to `$derived` … unless …form fields with `bind:value`").
  // The user can switch Typ inside the sheet without us snapping it back.
  let routeType = $state<RouteType>(untrack(() => initialType));
  let name = $state("");
  let comment = $state("");
  // Current stroke; committed strokes live in `lines` (see pointerUp).
  let path = $state<[number, number][]>([]);
  let lines = $state<[number, number][][]>([]);
  let saveError = $state<string | null>(null);

  // Only two combined options → vehicle type is implied.
  const vehicleType = $derived<VehicleType>(
    routeType === "rueckegasse" ? "kleingerät" : "großgerät"
  );
  const routeTypeLabel = $derived(
    routeType === "rueckegasse" ? "Rückegasse (Traktor)" : "Straße (LKW)"
  );

  const SOURCE_ID = "route-draft";
  const LAYER_SOLID_A = "route-draft-solid-a";
  const LAYER_SOLID_B = "route-draft-solid-b";
  const LAYER_DASHED_A = "route-draft-dashed-a";
  const LAYER_DASHED_B = "route-draft-dashed-b";

  function ensureLayer() {
    if (mlMap.getSource(SOURCE_ID)) return;
    mlMap.addSource(SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    const basePaint = {
      "line-color": "#2563eb",
      "line-opacity": 0.95,
      "line-width": 2,
    };
    const offsetA = { ...basePaint, "line-offset": -2 };
    const offsetB = { ...basePaint, "line-offset": 2 };
    const dashedA = {
      ...offsetA,
      "line-dasharray": [2, 2],
    };
    const dashedB = {
      ...offsetB,
      "line-dasharray": [2, 2],
    };

    mlMap.addLayer({
      id: LAYER_SOLID_A,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: "visible" },
      paint: offsetA,
    });
    mlMap.addLayer({
      id: LAYER_SOLID_B,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: "visible" },
      paint: offsetB,
    });
    mlMap.addLayer({
      id: LAYER_DASHED_A,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: dashedA,
    });
    mlMap.addLayer({
      id: LAYER_DASHED_B,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: "none" },
      paint: dashedB,
    });
  }

  function lineFeatures(coords: [number, number][]) {
    if (coords.length < 2) return [];
    return [
      {
        type: "Feature" as const,
        properties: {},
        geometry: { type: "LineString" as const, coordinates: coords },
      },
    ];
  }

  function updatePreview() {
    const src = mlMap.getSource(SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    const fromCommitted = lines.flatMap((c) => lineFeatures(c));
    const current = lineFeatures(path);
    const features = [...fromCommitted, ...current];
    if (features.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData({ type: "FeatureCollection", features });
  }

  function clearPreview() {
    for (const id of [
      LAYER_SOLID_A,
      LAYER_SOLID_B,
      LAYER_DASHED_A,
      LAYER_DASHED_B,
    ]) {
      if (mlMap.getLayer(id)) mlMap.removeLayer(id);
    }
    if (mlMap.getSource(SOURCE_ID)) mlMap.removeSource(SOURCE_ID);
  }

  // Pointer plumbing — we drive drawing off the canvas itself so a single
  // finger gesture builds one continuous path. Map gestures stay disabled.
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
    if (phase !== "drawing") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drawing = true;
    try {
      canvas?.setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported in some browsers — ignore */
    }
    path = [pointToLngLat(e.clientX, e.clientY)];
    updatePreview();
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent) {
    if (!drawing) return;
    // Sample at >= 2 px steps to keep the polyline reasonable.
    if (pixelDistanceFromLast(e.clientX, e.clientY) < 2) return;
    path = [...path, pointToLngLat(e.clientX, e.clientY)];
    updatePreview();
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
    if (path.length < 2) {
      // Treat as accidental tap — drop the seed point and stay in drawing.
      path = [];
      updatePreview();
      return;
    }
    lines = [...lines, path];
    path = [];
    updatePreview();
  }

  $effect(() => {
    canvas = mlMap.getCanvasContainer();
    ensureLayer();
    // Lock pan/zoom so freehand strokes don't slide the map (§6.2).
    const handlers = [
      mlMap.dragPan,
      mlMap.scrollZoom,
      mlMap.doubleClickZoom,
      mlMap.touchZoomRotate,
      mlMap.boxZoom,
      mlMap.dragRotate,
    ];
    for (const h of handlers) h.disable();

    // On touch devices the canvas container ships with `touch-action: pan-x
    // pan-y` (so the browser can pan/zoom the map). That same setting makes
    // the browser claim our finger gesture for scrolling, firing
    // `pointercancel` after the very first event — which is why drawing
    // "only places a dot" in mobile emulation. Disable browser-handled
    // gestures while the tool is mounted; restore on teardown.
    const prevTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = "none";

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas?.removeEventListener("pointerdown", onPointerDown);
      canvas?.removeEventListener("pointermove", onPointerMove);
      canvas?.removeEventListener("pointerup", onPointerUp);
      canvas?.removeEventListener("pointercancel", onPointerUp);
      if (canvas) canvas.style.touchAction = prevTouchAction;
      for (const h of handlers) h.enable();
      clearPreview();
    };
  });

  $effect(() => {
    // Toggle solid vs dashed preview depending on the chosen route type.
    const dashed = routeType === "rueckegasse";
    for (const id of [LAYER_DASHED_A, LAYER_DASHED_B]) {
      if (mlMap.getLayer(id))
        mlMap.setLayoutProperty(id, "visibility", dashed ? "visible" : "none");
    }
    for (const id of [LAYER_SOLID_A, LAYER_SOLID_B]) {
      if (mlMap.getLayer(id))
        mlMap.setLayoutProperty(id, "visibility", dashed ? "none" : "visible");
    }
  });

  function redo() {
    path = [];
    lines = [];
    updatePreview();
    phase = "drawing";
  }

  function accept() {
    if (lines.length === 0) return;
    saveError = null;
    phase = "form";
  }

  function pathDataFromLines() {
    if (lines.length === 0) {
      throw new Error("Kein Weg gezeichnet.");
    }
    if (lines.length === 1) {
      return { type: "LineString" as const, coordinates: lines[0] };
    }
    return { type: "MultiLineString" as const, coordinates: lines };
  }

  async function submit() {
    saveError = null;
    phase = "saving";
    try {
      await onSave({
        routeType,
        vehicleType,
        name: name.trim() || null,
        comment: comment.trim() || null,
        pathData: pathDataFromLines(),
      });
    } catch (e) {
      saveError = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
      phase = "form";
    }
  }
</script>

{#if phase === "drawing"}
  <!-- Top banner — mirrors the Baum-Platzieren banner style. -->
  <div
    class="absolute left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-3 pl-4 pr-2 py-2 rounded-pill text-earth font-medium text-sm shadow-canopy animate-rise pointer-events-auto"
    style="top: calc(0.75rem + env(safe-area-inset-top)); background: var(--color-pine-deep);"
  >
    <span class="w-2 h-2 rounded-full bg-ember animate-breathe"></span>
    <span>Striche mit dem Finger zeichnen</span>
    <button
      class="w-7 h-7 min-h-0 min-w-0 grid place-items-center rounded-full text-earth border-0"
      style="background: color-mix(in srgb, var(--color-earth) 14%, transparent);"
      onclick={onCancel}
      aria-label="Abbrechen"
    >
      <X size="0.9em" weight="bold" />
    </button>
  </div>
  <div
    class="absolute left-1/2 -translate-x-1/2 z-30 inline-flex items-center gap-2 px-2 py-2 rounded-pill bg-surface border shadow-canopy animate-rise pointer-events-auto"
    style="bottom: calc(1.5rem + env(safe-area-inset-bottom));"
    role="status"
  >
    <button
      class="inline-flex items-center gap-2 px-3 py-2 min-h-[42px] rounded-pill text-ink border-0 bg-transparent font-semibold text-sm hover:bg-surface-muted"
      onclick={redo}
    >
      <ArrowCounterClockwise size="1em" weight="bold" />
      Wiederholen
    </button>
    <button
      class="inline-flex items-center gap-2 px-4 py-2 min-h-[42px] rounded-pill text-earth border-0 font-semibold text-sm shadow-understory disabled:opacity-50 disabled:pointer-events-none"
      style="background: var(--color-pine);"
      onclick={accept}
      type="button"
      disabled={lines.length === 0}
    >
      <Check size="1em" weight="bold" />
      Übernehmen
    </button>
  </div>
{/if}

{#if phase === "form" || phase === "saving"}
  <!-- Backdrop — clicking it doesn't dismiss; users must use Abbrechen so
       they can't lose the freshly drawn path by accident. -->
  <div
    class="absolute inset-0 z-30 pointer-events-auto"
    style="background: color-mix(in srgb, var(--color-ink) 35%, transparent);"
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
        <div class="flex-1 flex flex-col gap-[2px]">
          <span class="eyebrow">Weg-Details</span>
          <h2
            class="font-serif font-medium text-[1.25rem] leading-tight tracking-tight text-ink m-0"
            style="font-variation-settings: 'opsz' 96, 'SOFT' 40, 'WONK' 1;"
          >
            {routeTypeLabel}
          </h2>
        </div>
        <button
          class="w-9 h-9 min-h-0 min-w-0 grid place-items-center rounded-full bg-transparent border text-content-muted hover:text-ink hover:border-pine"
          onclick={onCancel}
          disabled={phase === "saving"}
          aria-label="Abbrechen"
        >
          <X size="1em" weight="bold" />
        </button>
      </div>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-semibold text-ink">Typ</span>
        <select
          class="px-3 py-2.5 min-h-[42px] rounded-btn bg-earth border text-ink text-sm focus:outline-none focus:border-pine"
          bind:value={routeType}
          disabled={phase === "saving"}
        >
          <option value="rueckegasse">Rückegasse (Traktor)</option>
          <option value="anfahrt">Straße (LKW)</option>
        </select>
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-semibold text-ink"
          >Name <span class="text-content-muted font-normal">(optional)</span
          ></span
        >
        <input
          type="text"
          class="px-3 py-2.5 min-h-[42px] rounded-btn bg-earth border text-ink text-sm focus:outline-none focus:border-pine"
          placeholder={routeType === "rueckegasse" ? "z.B. Gasse Nord" : (
            "z.B. Von der Landstraße"
          )}
          maxlength="120"
          bind:value={name}
          disabled={phase === "saving"}
        />
      </label>

      <label class="flex flex-col gap-1.5 text-sm">
        <span class="font-semibold text-ink"
          >Kommentar <span class="text-content-muted font-normal"
            >(optional)</span
          ></span
        >
        <textarea
          class="px-3 py-2.5 min-h-[88px] rounded-btn bg-earth border text-ink text-sm focus:outline-none focus:border-pine resize-y"
          placeholder="z.B. Im Winter unpassierbar. Schranke, Schlüssel beim Nachbarn."
          maxlength="2000"
          rows="3"
          bind:value={comment}
          disabled={phase === "saving"}
        ></textarea>
      </label>

      {#if saveError}
        <p class="text-sm text-crimson">{saveError}</p>
      {/if}

      <div class="flex gap-2 justify-end pt-1">
        <button
          class="inline-flex items-center justify-center px-4 py-2.5 min-h-[44px] rounded-pill bg-transparent border text-ink font-semibold text-sm hover:border-pine"
          onclick={onCancel}
          disabled={phase === "saving"}
        >
          Abbrechen
        </button>
        <button
          class="inline-flex items-center justify-center px-5 py-2.5 min-h-[44px] rounded-pill text-earth border font-semibold text-sm shadow-understory disabled:opacity-60"
          style="background: var(--color-pine); border-color: color-mix(in srgb, var(--color-pine) 70%, black);"
          onclick={submit}
          disabled={phase === "saving"}
        >
          {phase === "saving" ? "Speichere…" : "Speichern"}
        </button>
      </div>
    </div>
  </div>
{/if}
