<script lang="ts">
  interface Props {
    class?: string;
    style?: string;
    track?: boolean;
  }

  let { class: klass = '', style = '', track = false }: Props = $props();

  let svgRef = $state<SVGSVGElement | undefined>();
  // Rest pose: arm slightly extended forward
  let shoulderDeg = $state(8);
  let forearmDeg = $state(-40);

  const PIVOT_X = 305;
  const PIVOT_Y = 252;
  const VIEW_W = 480;
  const VIEW_H = 800;
  const L1 = 92;
  const L2 = 112;

  $effect(() => {
    if (!track || !svgRef) return;
    const onMove = (e: MouseEvent) => {
      const r = svgRef!.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const scale = r.height / VIEW_H;
      const sx = r.left + (PIVOT_X / VIEW_W) * r.width;
      const sy = r.top + (PIVOT_Y / VIEW_H) * r.height;
      const dx = (e.clientX - sx) / scale;
      const dy = (e.clientY - sy) / scale;

      let a1 = Math.atan2(dy, dx);
      a1 = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, a1));

      const rightTarget = window.innerWidth * 1.06;
      const ext = Math.max(0, Math.min(1, (e.clientX - sx) / Math.max(1, rightTarget - sx)));

      const minD = Math.max(Math.abs(L1 - L2) + 8, 50);
      const maxD = L1 + L2 - 4;
      const d = minD + ext * (maxD - minD);

      const cosShoulder = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
      const cosElbow = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
      const shoulderInner = Math.acos(Math.max(-1, Math.min(1, cosShoulder)));
      const elbowInner = Math.acos(Math.max(-1, Math.min(1, cosElbow)));

      shoulderDeg = ((a1 + shoulderInner) * 180) / Math.PI;
      forearmDeg = (-(Math.PI - elbowInner) * 180) / Math.PI;
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => window.removeEventListener('mousemove', onMove);
  });
</script>

<svg
  bind:this={svgRef}
  viewBox="0 0 480 800"
  class={klass}
  style="overflow: visible; {style}"
  xmlns="http://www.w3.org/2000/svg"
  preserveAspectRatio="xMidYMax meet"
  aria-hidden="true"
>
  <defs>
    <linearGradient id="m-cloak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#28503a" />
      <stop offset="50%" stop-color="#152a1d" />
      <stop offset="100%" stop-color="#070d09" />
    </linearGradient>
    <linearGradient id="m-cloak-arm" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#1c3826" />
      <stop offset="100%" stop-color="#0b1610" />
    </linearGradient>
    <linearGradient id="m-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6b4a32" />
      <stop offset="100%" stop-color="#2b1d14" />
    </linearGradient>
    <linearGradient id="m-skin" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#b89a72" />
      <stop offset="60%" stop-color="#8a6e4c" />
      <stop offset="100%" stop-color="#5a4128" />
    </linearGradient>
    <radialGradient id="m-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff3c8" stop-opacity="0.95" />
      <stop offset="35%" stop-color="#d4a23c" stop-opacity="0.7" />
      <stop offset="100%" stop-color="#d4a23c" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="m-brim-shadow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(7,13,9,0.85)" />
      <stop offset="100%" stop-color="rgba(7,13,9,0)" />
    </linearGradient>
    <filter id="m-soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
  </defs>

  <!-- Ground shadow -->
  <ellipse cx="240" cy="780" rx="170" ry="11" fill="#000" opacity="0.5" filter="url(#m-soft)" />

  <!-- Cloak — high collar comes right up to the chin so there's no neck -->
  <path
    d="M 218 230
       C 210 236, 198 246, 194 252
       L 184 300
       C 166 308, 154 334, 148 372
       L 120 770
       L 158 752
       L 178 770
       L 208 750
       L 240 770
       L 272 750
       L 302 770
       L 322 752
       L 360 770
       L 332 372
       C 326 334, 314 308, 296 300
       L 286 252
       C 282 246, 270 236, 262 230
       Q 240 224, 218 230 Z"
    fill="url(#m-cloak)"
  />

  <!-- Cloak fold lines -->
  <path d="M 196 320 L 168 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />
  <path d="M 220 340 L 215 760" stroke="#070d09" stroke-width="1" opacity="0.4" fill="none" />
  <path d="M 240 340 L 240 762" stroke="#070d09" stroke-width="0.9" opacity="0.35" fill="none" />
  <path d="M 260 340 L 265 760" stroke="#070d09" stroke-width="1" opacity="0.4" fill="none" />
  <path d="M 284 320 L 312 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />

  <!-- Collar fold (single subtle line at the seam) -->
  <path d="M 200 252 C 222 244, 258 244, 280 252" stroke="#070d09" stroke-width="1.4" opacity="0.6" fill="none" />

  <!-- Head (skin) — sits directly on the collar -->
  <ellipse cx="240" cy="186" rx="36" ry="40" fill="url(#m-skin)" />
  <ellipse cx="222" cy="206" rx="6" ry="5" fill="#d6b88a" opacity="0.18" />
  <ellipse cx="258" cy="206" rx="6" ry="5" fill="#d6b88a" opacity="0.18" />

  <!-- Hat — denser leaf pile, lots of distinct leaves at varied angles -->
  <g>
    <!-- Brim with a leafy uneven edge -->
    <path
      d="M 154 204
         C 158 196, 168 188, 180 188
         C 188 184, 196 188, 204 184
         C 214 180, 224 184, 232 180
         C 240 176, 248 180, 256 180
         C 264 184, 274 180, 282 184
         C 292 188, 304 192, 312 196
         C 320 200, 322 208, 318 212
         C 308 216, 296 212, 282 214
         C 266 216, 250 214, 240 214
         C 226 214, 210 216, 196 214
         C 182 212, 170 216, 162 212
         C 156 210, 152 208, 154 204 Z"
      fill="#1f3520"
    />
    <!-- Brim highlight along the top -->
    <path d="M 168 196 C 192 188, 240 184, 290 188 C 306 192, 310 198, 296 198 C 240 194, 200 198, 174 200 C 168 200, 168 198, 168 196 Z" fill="#3d5b30" opacity="0.7" />

    <!-- Lower leaf layer — many distinct leaves -->
    <path d="M 168 192 C 158 178, 168 156, 184 162 C 188 174, 184 188, 168 192 Z" fill="#2a4422" />
    <path d="M 188 184 C 178 168, 188 148, 204 152 C 210 168, 204 184, 188 184 Z" fill="#3d5b30" />
    <path d="M 210 178 C 200 162, 212 142, 226 148 C 232 162, 224 180, 210 178 Z" fill="#4f6c3a" />
    <path d="M 240 174 C 232 156, 248 144, 256 152 C 260 168, 252 180, 240 174 Z" fill="#3d5b30" />
    <path d="M 268 178 C 280 162, 268 142, 254 148 C 248 162, 256 180, 268 178 Z" fill="#4f6c3a" />
    <path d="M 290 184 C 300 168, 290 148, 274 152 C 268 168, 274 184, 290 184 Z" fill="#3d5b30" />
    <path d="M 308 192 C 320 180, 312 156, 296 162 C 290 174, 296 188, 308 192 Z" fill="#2a4422" />

    <!-- Mid leaf layer -->
    <path d="M 184 162 C 174 142, 188 122, 204 130 C 208 146, 200 162, 184 162 Z" fill="#3d5b30" />
    <path d="M 210 144 C 202 124, 218 104, 232 116 C 234 132, 224 148, 210 144 Z" fill="#5d7a4a" />
    <path d="M 240 138 C 232 118, 250 102, 258 116 C 260 132, 252 148, 240 138 Z" fill="#4f6c3a" />
    <path d="M 270 144 C 280 124, 264 104, 250 116 C 248 132, 258 148, 270 144 Z" fill="#5d7a4a" />
    <path d="M 296 162 C 306 142, 294 122, 278 130 C 274 146, 282 162, 296 162 Z" fill="#3d5b30" />

    <!-- Upper leaves (top crown) -->
    <path d="M 206 122 C 200 100, 218 86, 230 100 C 232 114, 220 128, 206 122 Z" fill="#5d7a4a" />
    <path d="M 230 110 C 226 88, 246 78, 252 96 C 250 112, 240 122, 230 110 Z" fill="#7aa36a" />
    <path d="M 250 110 C 254 88, 234 78, 228 96 C 230 112, 240 122, 250 110 Z" fill="#7aa36a" />
    <path d="M 274 122 C 280 100, 262 86, 250 100 C 248 114, 260 128, 274 122 Z" fill="#5d7a4a" />

    <!-- Cap top sprigs -->
    <path d="M 234 96 C 226 70, 240 58, 246 80 C 244 92, 238 100, 234 96 Z" fill="#4f6c3a" />
    <path d="M 248 80 Q 256 56, 262 44" stroke="#3d5b30" stroke-width="1.8" fill="none" stroke-linecap="round" />
    <path d="M 262 44 C 256 38, 268 30, 272 40 C 270 50, 266 50, 262 44 Z" fill="#5d7a4a" />
    <path d="M 244 70 Q 240 50, 236 38" stroke="#3d5b30" stroke-width="1.4" fill="none" stroke-linecap="round" />
    <path d="M 236 38 C 230 36, 234 28, 240 30 C 242 36, 238 40, 236 38 Z" fill="#7aa36a" />

    <!-- Side small leaves spilling out of the brim -->
    <path d="M 152 200 C 144 196, 142 204, 148 208 C 154 208, 156 204, 152 200 Z" fill="#3d5b30" />
    <path d="M 164 212 C 156 214, 158 220, 164 218 C 168 216, 168 212, 164 212 Z" fill="#5d7a4a" />
    <path d="M 322 200 C 330 196, 332 204, 326 208 C 320 208, 318 204, 322 200 Z" fill="#3d5b30" />
    <path d="M 312 212 C 320 214, 318 220, 312 218 C 308 216, 308 212, 312 212 Z" fill="#5d7a4a" />

    <!-- Vein details on a few prominent leaves -->
    <path d="M 226 100 Q 226 116, 226 130" stroke="#243d1d" stroke-width="0.7" fill="none" opacity="0.55" />
    <path d="M 254 100 Q 254 116, 254 130" stroke="#243d1d" stroke-width="0.7" fill="none" opacity="0.55" />
    <path d="M 196 168 Q 198 178, 198 188" stroke="#162513" stroke-width="0.6" fill="none" opacity="0.5" />
    <path d="M 284 168 Q 282 178, 282 188" stroke="#162513" stroke-width="0.6" fill="none" opacity="0.5" />

    <!-- Berries scattered -->
    <circle cx="216" cy="138" r="2" fill="#962a2a" opacity="0.85" />
    <circle cx="220" cy="144" r="1.4" fill="#962a2a" opacity="0.7" />
    <circle cx="264" cy="138" r="2" fill="#962a2a" opacity="0.85" />
    <circle cx="240" cy="120" r="1.6" fill="#c98f2a" opacity="0.85" />
    <circle cx="200" cy="172" r="1.4" fill="#c98f2a" opacity="0.7" />
    <circle cx="280" cy="172" r="1.4" fill="#c98f2a" opacity="0.7" />

    <!-- Brim shadow over the upper face — fades just above the smile -->
    <path
      d="M 178 210
         C 200 220, 280 220, 302 210
         L 302 224
         C 280 220, 200 220, 178 224 Z"
      fill="url(#m-brim-shadow)"
    />
  </g>

  <!-- Smile — the only feature peeking under the brim -->
  <path d="M 230 222 Q 240 228, 250 222" stroke="#2a1810" stroke-width="1.6" fill="none" stroke-linecap="round" />

  <!-- Staff -->
  <g>
    <line x1="170" y1="84" x2="178" y2="700" stroke="url(#m-wood)" stroke-width="6.5" stroke-linecap="round" />
    <rect x="167" y="305" width="14" height="6" rx="1.5" fill="#3a2618" />
    <rect x="167" y="318" width="14" height="2" rx="1" fill="#3a2618" />
    <rect x="172" y="500" width="10" height="3" rx="1" fill="#3a2618" />

    <g transform="translate(170 70)">
      <circle cx="0" cy="0" r="46" fill="url(#m-glow)" />
      <path d="M -3 -10 C -16 -16, -26 -32, -22 -46 C -12 -40, -4 -22, -3 -10 Z" fill="#3d5b30" />
      <path d="M 3 -10 C 16 -16, 26 -32, 22 -46 C 12 -40, 4 -22, 3 -10 Z" fill="#3d5b30" />
      <path d="M -8 -4 C -22 -2, -32 8, -26 18 C -16 14, -10 4, -8 -4 Z" fill="#5d7a4a" />
      <path d="M 8 -4 C 22 -2, 32 8, 26 18 C 16 14, 10 4, 8 -4 Z" fill="#5d7a4a" />
      <path d="M 0 -22 L 8 -8 L 5 16 L -5 16 L -8 -8 Z" fill="#e6b54c" stroke="#a87a22" stroke-width="0.6" />
      <path d="M 0 -22 L 8 -8 L 0 -2 L -8 -8 Z" fill="#fff3c8" opacity="0.85" />
      <path d="M -5 16 L 0 -2 L 5 16 Z" fill="#a87a22" opacity="0.5" />
    </g>

    <ellipse cx="175" cy="372" rx="12" ry="14" fill="#1a1208" />
    <path d="M 168 366 Q 175 360, 184 364" stroke="#3a2618" stroke-width="1.2" fill="none" />
  </g>

  <!-- Pointing arm — 2-bone IK -->
  <g
    style="transform: rotate({shoulderDeg}deg); transform-origin: {PIVOT_X}px {PIVOT_Y}px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
  >
    <path
      d="M 295 240
         C 320 236, 360 240, 395 246
         L 395 260
         C 360 266, 320 270, 295 264 Z"
      fill="url(#m-cloak-arm)"
    />
    <path d="M 305 248 C 340 250, 375 252, 392 254" stroke="#070d09" stroke-width="1" opacity="0.5" fill="none" />
    <ellipse cx="395" cy="253" rx="11" ry="9" fill="#070d09" opacity="0.55" />

    <g
      style="transform: rotate({forearmDeg}deg); transform-origin: 395px 253px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
    >
      <path
        d="M 392 246
           C 420 246, 470 250, 502 252
           L 502 258
           C 470 261, 420 261, 392 261 Z"
        fill="url(#m-cloak-arm)"
      />
      <path d="M 400 254 C 440 255, 480 256, 500 256" stroke="#070d09" stroke-width="1" opacity="0.45" fill="none" />
      <path d="M 498 248 C 512 250, 516 258, 508 262 L 498 262 Z" fill="#0b1610" />

      <ellipse cx="513" cy="255" rx="9" ry="6.5" fill="#c4b48b" />
      <path d="M 508 251 Q 514 248, 520 251" stroke="#7a6a48" stroke-width="0.6" fill="none" opacity="0.6" />

      <g transform="translate(519 255)">
        <path d="M 0 0 C 30 -3, 60 -6, 92 -10" stroke="#5a3d2b" stroke-width="2.8" fill="none" stroke-linecap="round" />
        <path d="M 0 0 C 30 -3, 60 -6, 92 -10" stroke="#7a5638" stroke-width="0.8" fill="none" stroke-linecap="round" opacity="0.8" />
        <path d="M 28 -3 C 30 -10, 36 -14, 42 -12" stroke="#5a3d2b" stroke-width="1.4" fill="none" stroke-linecap="round" />
        <path d="M 58 -6 C 60 0, 64 4, 70 4" stroke="#5a3d2b" stroke-width="1.2" fill="none" stroke-linecap="round" />
        <path d="M 42 -12 C 48 -18, 50 -22, 46 -26 C 42 -22, 38 -18, 42 -12 Z" fill="#5d7a4a" />
        <path d="M 70 4 C 76 8, 80 8, 80 4 C 78 0, 74 0, 70 4 Z" fill="#7aa36a" />
        <circle cx="94" cy="-10" r="20" fill="url(#m-glow)" />
        <circle cx="94" cy="-10" r="3.4" fill="#fff3c8" />
        <circle cx="94" cy="-10" r="1.6" fill="#fff" />
      </g>
    </g>
  </g>
</svg>
