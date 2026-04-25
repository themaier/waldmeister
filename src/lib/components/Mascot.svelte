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

      // Direction toward mouse, clamped to forward hemisphere so the arm doesn't snap behind.
      let a1 = Math.atan2(dy, dx);
      a1 = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, a1));

      // Extension factor: 0 at the shoulder column, 1 at viewport right + 6% (slightly past the page).
      // This keeps the arm bent through most of the right side and only fully stretches past the edge.
      const rightTarget = window.innerWidth * 1.06;
      const ext = Math.max(0, Math.min(1, (e.clientX - sx) / Math.max(1, rightTarget - sx)));

      const minD = Math.max(Math.abs(L1 - L2) + 8, 50);
      const maxD = L1 + L2 - 4;
      const d = minD + ext * (maxD - minD);

      // 2-bone IK via law of cosines, elbow biased downward so both joints visibly move with the cursor.
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

  <!-- Cloak silhouette — raised neckline so head sits on shoulders without an elongated neck -->
  <path
    d="M 224 220
       C 218 224, 200 234, 194 252
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
       C 280 234, 262 224, 256 220
       L 224 220 Z"
    fill="url(#m-cloak)"
  />

  <!-- Cloak fold lines -->
  <path d="M 196 320 L 168 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />
  <path d="M 220 340 L 215 760" stroke="#070d09" stroke-width="1" opacity="0.4" fill="none" />
  <path d="M 240 340 L 240 762" stroke="#070d09" stroke-width="0.9" opacity="0.35" fill="none" />
  <path d="M 260 340 L 265 760" stroke="#070d09" stroke-width="1" opacity="0.4" fill="none" />
  <path d="M 284 320 L 312 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />

  <!-- Shoulder rim highlight -->
  <path d="M 198 240 C 222 222, 258 222, 282 240" stroke="#5d7a4a" stroke-width="1.2" opacity="0.4" fill="none" />
  <!-- Collar fold -->
  <path d="M 196 254 C 220 246, 260 246, 284 254" stroke="#070d09" stroke-width="1.6" opacity="0.7" fill="none" />

  <!-- Shoulder leaves (forest growth) -->
  <path d="M 200 264 C 192 258, 184 264, 188 272 C 196 274, 204 270, 200 264 Z" fill="#3d5b30" />
  <path d="M 196 268 C 198 274, 204 274, 202 270 Z" fill="#5d7a4a" />
  <path d="M 280 264 C 288 258, 296 264, 292 272 C 284 274, 276 270, 280 264 Z" fill="#3d5b30" />
  <path d="M 284 268 C 282 274, 276 274, 278 270 Z" fill="#5d7a4a" />

  <!-- Head (skin) — bare, no hood -->
  <ellipse cx="240" cy="186" rx="38" ry="42" fill="url(#m-skin)" />
  <!-- Subtle skin highlight to suggest cheek -->
  <ellipse cx="222" cy="208" rx="6" ry="5" fill="#d6b88a" opacity="0.18" />
  <ellipse cx="258" cy="208" rx="6" ry="5" fill="#d6b88a" opacity="0.18" />

  <!-- Leafy beard — drawn before the smile so the smile sits on top -->
  <g>
    <!-- Outer base shadow -->
    <path
      d="M 206 218
         C 198 240, 204 270, 222 282
         C 236 288, 244 288, 258 282
         C 276 270, 282 240, 274 218
         C 258 232, 240 234, 222 232
         C 216 228, 210 224, 206 218 Z"
      fill="#162513"
    />
    <!-- Dark mid layer -->
    <path
      d="M 212 222
         C 206 244, 212 270, 226 278
         C 240 282, 254 278, 254 278
         C 268 270, 274 244, 268 222
         C 254 232, 240 234, 226 232 Z"
      fill="#243d1d"
    />
    <!-- Side leaf cluster -->
    <path d="M 216 232 C 208 248, 210 270, 224 274 C 230 264, 226 250, 220 234 Z" fill="#2a4422" />
    <path d="M 264 232 C 272 248, 270 270, 256 274 C 250 264, 254 250, 260 234 Z" fill="#2a4422" />
    <!-- Hanging center mass -->
    <path
      d="M 224 240
         C 218 260, 226 280, 240 282
         C 254 280, 262 260, 256 240
         C 248 250, 232 250, 224 240 Z"
      fill="#3d5b30"
    />
    <!-- Inner leaves -->
    <path d="M 222 250 C 216 262, 222 274, 230 270 C 232 262, 228 254, 222 250 Z" fill="#4f6c3a" />
    <path d="M 258 250 C 264 262, 258 274, 250 270 C 248 262, 252 254, 258 250 Z" fill="#4f6c3a" />
    <path d="M 234 256 C 230 270, 240 282, 244 270 C 244 264, 240 258, 234 256 Z" fill="#5d7a4a" />
    <path d="M 246 256 C 250 270, 240 282, 236 270 C 236 264, 240 258, 246 256 Z" fill="#5d7a4a" />
    <!-- Highlight tips -->
    <path d="M 230 264 C 228 272, 234 276, 234 268 C 234 266, 232 264, 230 264 Z" fill="#7aa36a" />
    <path d="M 250 264 C 252 272, 246 276, 246 268 C 246 266, 248 264, 250 264 Z" fill="#7aa36a" />
    <!-- Tucked under chin -->
    <path d="M 218 222 C 214 232, 220 236, 224 230 C 224 226, 220 222, 218 222 Z" fill="#3d5b30" />
    <path d="M 262 222 C 266 232, 260 236, 256 230 C 256 226, 260 222, 262 222 Z" fill="#3d5b30" />
    <!-- Vein details -->
    <path d="M 222 234 Q 224 250, 226 268" stroke="#162513" stroke-width="0.7" fill="none" opacity="0.6" />
    <path d="M 258 234 Q 256 250, 254 268" stroke="#162513" stroke-width="0.7" fill="none" opacity="0.6" />
    <path d="M 240 246 Q 240 262, 240 278" stroke="#243d1d" stroke-width="0.8" fill="none" opacity="0.7" />
    <!-- Tiny berry accents -->
    <circle cx="232" cy="240" r="1.4" fill="#962a2a" opacity="0.85" />
    <circle cx="248" cy="240" r="1.4" fill="#962a2a" opacity="0.85" />
    <circle cx="240" cy="266" r="1.2" fill="#c98f2a" opacity="0.8" />
  </g>

  <!-- Hat — sits directly on the head, brim pulled low to hide the upper face -->
  <g>
    <!-- Outer brim wraps the head, sticking out a touch -->
    <path
      d="M 156 200
         C 168 184, 196 174, 240 174
         C 284 174, 312 184, 324 200
         C 314 212, 282 210, 240 210
         C 198 210, 166 212, 156 200 Z"
      fill="#1f3520"
    />
    <!-- Brim highlight -->
    <path
      d="M 168 192 C 190 184, 240 180, 290 184 C 304 188, 308 196, 296 198 C 240 192, 200 196, 174 198 C 168 196, 168 194, 168 192 Z"
      fill="#3d5b30"
      opacity="0.55"
    />
    <!-- Lower foliage just above brim -->
    <path
      d="M 168 188
         C 176 156, 208 130, 240 134
         C 272 130, 304 156, 312 188
         C 300 192, 274 184, 240 184
         C 206 184, 180 192, 168 188 Z"
      fill="#3d5b30"
    />
    <!-- Mid foliage -->
    <path
      d="M 184 162
         C 192 134, 218 112, 240 120
         C 262 112, 288 134, 296 162
         C 282 168, 262 158, 240 158
         C 218 158, 198 168, 184 162 Z"
      fill="#4f6c3a"
    />
    <!-- Top crest -->
    <path
      d="M 206 134
         C 212 104, 230 90, 240 102
         C 250 90, 268 104, 274 134
         C 264 138, 250 128, 240 128
         C 230 128, 216 138, 206 134 Z"
      fill="#5d7a4a"
    />
    <!-- Individual leaf accents -->
    <path d="M 192 150 C 184 138, 192 122, 204 130 C 206 142, 200 154, 192 150 Z" fill="#3d5b30" />
    <path d="M 218 124 C 212 102, 230 92, 234 112 C 232 126, 226 130, 218 124 Z" fill="#7aa36a" />
    <path d="M 262 124 C 268 102, 250 92, 246 112 C 248 126, 254 130, 262 124 Z" fill="#7aa36a" />
    <path d="M 288 150 C 296 138, 288 122, 276 130 C 274 142, 280 154, 288 150 Z" fill="#3d5b30" />
    <!-- Leaf veins -->
    <path d="M 226 110 Q 226 126, 228 142" stroke="#243d1d" stroke-width="0.8" fill="none" opacity="0.6" />
    <path d="M 254 110 Q 254 126, 252 142" stroke="#243d1d" stroke-width="0.8" fill="none" opacity="0.6" />
    <!-- Top sprig -->
    <path d="M 246 102 C 240 80, 252 66, 254 84 C 252 96, 250 104, 246 102 Z" fill="#4f6c3a" />
    <path d="M 252 80 Q 260 56, 266 44" stroke="#3d5b30" stroke-width="1.6" fill="none" stroke-linecap="round" />
    <path d="M 266 44 C 262 38, 270 32, 273 40 C 272 48, 268 50, 266 44 Z" fill="#5d7a4a" />
    <!-- Berries -->
    <circle cx="218" cy="140" r="2" fill="#962a2a" opacity="0.85" />
    <circle cx="222" cy="146" r="1.4" fill="#962a2a" opacity="0.7" />
    <circle cx="262" cy="140" r="2" fill="#962a2a" opacity="0.85" />
    <circle cx="240" cy="124" r="1.6" fill="#c98f2a" opacity="0.8" />
    <!-- Brim shadow over face — fades down past the smile so just the smile peeks out -->
    <path
      d="M 178 200
         C 200 214, 280 214, 302 200
         L 302 222
         C 280 218, 200 218, 178 222 Z"
      fill="url(#m-brim-shadow)"
    />
  </g>

  <!-- Smile — just a soft kind curve, the only feature visible under the brim -->
  <path d="M 230 218 Q 240 224, 250 218" stroke="#2a1810" stroke-width="1.6" fill="none" stroke-linecap="round" />
  <!-- Tiny moustache leaf wisps flanking the smile -->
  <path d="M 230 215 Q 222 219, 218 217 Q 222 213, 230 215 Z" fill="#3d5b30" opacity="0.85" />
  <path d="M 250 215 Q 258 219, 262 217 Q 258 213, 250 215 Z" fill="#3d5b30" opacity="0.85" />

  <!-- Staff -->
  <g>
    <line x1="170" y1="84" x2="178" y2="700" stroke="url(#m-wood)" stroke-width="6.5" stroke-linecap="round" />
    <rect x="167" y="305" width="14" height="6" rx="1.5" fill="#3a2618" />
    <rect x="167" y="318" width="14" height="2" rx="1" fill="#3a2618" />
    <rect x="172" y="500" width="10" height="3" rx="1" fill="#3a2618" />

    <!-- Crystal-leaf crown -->
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

    <!-- Hand grip -->
    <ellipse cx="175" cy="372" rx="12" ry="14" fill="#1a1208" />
    <path d="M 168 366 Q 175 360, 184 364" stroke="#3a2618" stroke-width="1.2" fill="none" />
  </g>

  <!-- Pointing arm — 2-bone IK -->
  <g
    style="transform: rotate({shoulderDeg}deg); transform-origin: {PIVOT_X}px {PIVOT_Y}px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
  >
    <!-- Upper arm (shoulder → elbow) -->
    <path
      d="M 295 240
         C 320 236, 360 240, 395 246
         L 395 260
         C 360 266, 320 270, 295 264 Z"
      fill="url(#m-cloak-arm)"
    />
    <path d="M 305 248 C 340 250, 375 252, 392 254" stroke="#070d09" stroke-width="1" opacity="0.5" fill="none" />
    <!-- Elbow shadow -->
    <ellipse cx="395" cy="253" rx="11" ry="9" fill="#070d09" opacity="0.55" />

    <!-- Forearm group (rotates around the elbow) -->
    <g
      style="transform: rotate({forearmDeg}deg); transform-origin: 395px 253px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
    >
      <!-- Forearm sleeve -->
      <path
        d="M 392 246
           C 420 246, 470 250, 502 252
           L 502 258
           C 470 261, 420 261, 392 261 Z"
        fill="url(#m-cloak-arm)"
      />
      <path d="M 400 254 C 440 255, 480 256, 500 256" stroke="#070d09" stroke-width="1" opacity="0.45" fill="none" />
      <!-- Cuff -->
      <path d="M 498 248 C 512 250, 516 258, 508 262 L 498 262 Z" fill="#0b1610" />

      <!-- Hand -->
      <ellipse cx="513" cy="255" rx="9" ry="6.5" fill="#c4b48b" />
      <path d="M 508 251 Q 514 248, 520 251" stroke="#7a6a48" stroke-width="0.6" fill="none" opacity="0.6" />

      <!-- Wand (untouched) -->
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
