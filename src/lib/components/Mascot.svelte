<script lang="ts">
  interface Props {
    class?: string;
    style?: string;
    track?: boolean;
  }

  let { class: klass = '', style = '', track = false }: Props = $props();

  let svgRef = $state<SVGSVGElement | undefined>();
  let shoulderDeg = $state(8);
  let forearmDeg = $state(-40);
  let staffY = $state(0);

  const PIVOT_X = 305;
  const PIVOT_Y = 268;
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

      // Staff vertical bob — only when the mouse is over the left half of the
      // mascot. The staff/hand translate together; pivot-less translation reads
      // as "raising/lowering" the staff with the cursor.
      const vbX = ((e.clientX - r.left) / r.width) * VIEW_W;
      const vbY = ((e.clientY - r.top) / r.height) * VIEW_H;
      if (vbX < 240) {
        staffY = Math.max(-70, Math.min(70, (vbY - 400) * 0.18));
      } else {
        staffY = 0;
      }
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
      <stop offset="0%" stop-color="#28503a" />
      <stop offset="60%" stop-color="#244934" />
      <stop offset="100%" stop-color="#1d3d2a" />
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
    <linearGradient id="m-beard" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8a8275" />
      <stop offset="60%" stop-color="#5a5346" />
      <stop offset="100%" stop-color="#2e2820" />
    </linearGradient>
    <linearGradient id="m-dome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3d5b30" />
      <stop offset="100%" stop-color="#1f3520" />
    </linearGradient>
    <radialGradient id="m-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fff3c8" stop-opacity="0.95" />
      <stop offset="35%" stop-color="#d4a23c" stop-opacity="0.7" />
      <stop offset="100%" stop-color="#d4a23c" stop-opacity="0" />
    </radialGradient>
    <filter id="m-soft" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="9" />
    </filter>
  </defs>

  <!-- Ground shadow -->
  <ellipse cx="240" cy="780" rx="170" ry="11" fill="#000" opacity="0.5" filter="url(#m-soft)" />

  <!-- Cloak — rounded dome top, egg-rounded shoulders, jagged hem at the bottom. -->
  <path
    d="M 194 210
       C 186 222, 168 236, 148 252
       C 144 290, 150 332, 148 372
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
       C 330 332, 336 290, 332 252
       C 312 236, 294 222, 286 210
       C 286 188, 252 178, 240 178
       C 228 178, 194 188, 194 210 Z"
    fill="url(#m-cloak)"
  />

  <!-- Cloak fold lines -->
  <path d="M 196 320 L 168 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />
  <path d="M 284 320 L 312 752" stroke="#070d09" stroke-width="1.4" opacity="0.55" fill="none" />

  <!-- Head — slimmer ellipse, sized to sit inside the beard wrap -->
  <ellipse cx="240" cy="210" rx="40" ry="40" fill="url(#m-skin)" />
  <!-- Tapered jaw extension — narrower so no skin pokes out past the beard sideburns -->
  <path
    d="M 206 238
       C 210 250, 218 258, 226 260
       L 254 260
       C 262 258, 270 250, 274 238
       C 264 246, 252 248, 240 248
       C 228 248, 216 246, 206 238 Z"
    fill="url(#m-skin)"
  />
  <ellipse cx="240" cy="190" rx="34" ry="14" fill="#1a0e06" opacity="0.5" />

  <!-- Beard — narrower wrap, sideburns reach the hat brim but stay tight to the jaw for a sharper face -->
  <path
    d="M 206 220
       C 200 236, 204 256, 214 268
       C 216 282, 220 294, 222 300
       L 222 290
       L 226 304
       L 230 292
       L 234 308
       L 238 296
       L 240 312
       L 242 296
       L 246 308
       L 250 292
       L 254 304
       L 258 290
       L 258 300
       C 260 294, 264 282, 266 268
       C 276 256, 280 236, 274 220
       C 268 226, 262 230, 256 232
       C 248 234, 232 234, 224 232
       C 218 230, 212 226, 206 220 Z"
    fill="url(#m-beard)"
  />
  <!-- Beard side-shading -->
  <path
    d="M 206 220
       C 202 236, 206 256, 216 268
       C 218 252, 220 238, 222 228
       C 216 226, 210 224, 206 220 Z"
    fill="#2e2820"
    opacity="0.45"
  />
  <path
    d="M 274 220
       C 278 236, 274 256, 264 268
       C 262 252, 260 238, 258 228
       C 264 226, 270 224, 274 220 Z"
    fill="#2e2820"
    opacity="0.45"
  />

  <!-- Hat -->
  <g>
    <!-- Magic-hat dome — wide flared base, bulging sides, soft curled apex -->
    <path
      d="M 162 212
         C 188 200, 196 170, 212 142
         C 224 122, 226 110, 240 100
         C 254 110, 256 122, 268 142
         C 284 170, 292 200, 318 212
         C 296 218, 270 218, 240 218
         C 210 218, 184 218, 162 212 Z"
      fill="url(#m-dome)"
    />

    <!-- Brim band — wide flared brim sweeping out to the sides -->
    <path
      d="M 152 214
         C 168 206, 198 202, 210 202
         L 270 202
         C 282 202, 312 206, 328 214
         C 312 224, 282 224, 270 222
         L 210 222
         C 198 224, 168 224, 152 214 Z"
      fill="#1a2f18"
    />
    <path d="M 168 218 C 200 222, 280 222, 312 218" stroke="#070d09" stroke-width="0.9" fill="none" opacity="0.5" />

    <!-- Bottom row — widest, overhanging the brim -->
    <path transform="translate(-14 0)" d="M 174 200 C 162 192, 162 176, 180 178 C 188 188, 184 206, 174 200 Z" fill="#2a4422" />
    <path transform="translate(-10 0)" d="M 192 200 C 184 188, 186 174, 198 178 C 204 188, 200 204, 192 200 Z" fill="#2a4422" />
    <path transform="translate(-6 0)" d="M 214 196 C 206 184, 208 168, 222 174 C 226 184, 222 200, 214 196 Z" fill="#3d5b30" />
    <path transform="translate(-3 0)" d="M 234 192 C 226 178, 230 162, 240 168 C 244 180, 242 196, 234 192 Z" fill="#4f6c3a" />
    <path transform="translate(3 0)" d="M 246 192 C 254 178, 250 162, 240 168 C 236 180, 238 196, 246 192 Z" fill="#3d5b30" />
    <path transform="translate(6 0)" d="M 266 196 C 274 184, 272 168, 258 174 C 254 184, 258 200, 266 196 Z" fill="#4f6c3a" />
    <path transform="translate(10 0)" d="M 288 200 C 296 188, 294 174, 282 178 C 276 188, 280 204, 288 200 Z" fill="#2a4422" />
    <path transform="translate(14 0)" d="M 306 200 C 318 192, 318 176, 300 178 C 292 188, 296 206, 306 200 Z" fill="#2a4422" />

    <!-- Mid row — narrower, follows the cone -->
    <path transform="translate(-12 0)" d="M 206 174 C 198 162, 204 146, 214 152 C 216 164, 212 188, 206 174 Z" fill="#5d7a4a" />
    <path transform="translate(-6 0)" d="M 218 178 C 210 164, 214 148, 226 154 C 230 166, 226 184, 218 178 Z" fill="#5d7a4a" />
    <path d="M 240 170 C 232 154, 248 144, 254 158 C 256 172, 248 184, 240 170 Z" fill="#7aa36a" />
    <path transform="translate(6 0)" d="M 262 178 C 270 164, 266 148, 254 154 C 250 166, 254 184, 262 178 Z" fill="#5d7a4a" />
    <path transform="translate(12 0)" d="M 274 174 C 282 162, 276 146, 266 152 C 264 164, 268 188, 274 174 Z" fill="#5d7a4a" />

    <!-- Upper row — small leaves near the apex -->
    <path transform="translate(-10 0)" d="M 222 156 C 214 142, 226 130, 232 142 C 232 152, 228 166, 222 156 Z" fill="#5d7a4a" />
    <path transform="translate(-4 0)" d="M 228 152 C 222 138, 234 128, 240 138 C 240 148, 234 160, 228 152 Z" fill="#7aa36a" />
    <path transform="translate(4 0)" d="M 252 152 C 258 138, 246 128, 240 138 C 240 148, 246 160, 252 152 Z" fill="#7aa36a" />
    <path transform="translate(10 0)" d="M 258 156 C 266 142, 254 130, 248 142 C 248 152, 252 166, 258 156 Z" fill="#5d7a4a" />

    <!-- Top cluster -->
    <path transform="translate(-6 0)" d="M 234 132 C 228 120, 238 110, 242 122 C 240 130, 236 140, 234 132 Z" fill="#7aa36a" />
    <path transform="translate(6 0)" d="M 246 132 C 252 120, 242 110, 238 122 C 240 130, 244 140, 246 132 Z" fill="#7aa36a" />

    <!-- Apex tip leaf -->
    <path d="M 240 116 C 234 106, 246 102, 246 114 C 244 122, 240 122, 240 116 Z" fill="#4f6c3a" />

    <!-- Berries — two on the dome -->
    <circle cx="232" cy="180" r="1.6" fill="#962a2a" opacity="0.85" />
    <circle cx="248" cy="180" r="1.6" fill="#962a2a" opacity="0.85" />
  </g>


  <!-- Mustache — bushy, drooping past the corners of the mouth -->
  <path
    d="M 214 234
       C 222 230, 232 232, 240 238
       C 248 232, 258 230, 266 234
       C 264 244, 254 248, 246 242
       C 242 244, 238 244, 234 242
       C 226 248, 216 244, 214 234 Z"
    fill="url(#m-beard)"
  />

  <!-- Mouth — small, serious, peeking between mustache and beard -->
  <path d="M 232 250 Q 240 253, 248 250" stroke="#2a1810" stroke-width="2" fill="none" stroke-linecap="round" />

  <!-- Staff -->
  <g
    style="transform: translateY({staffY}px); transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
  >
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

    <ellipse cx="175" cy="372" rx="12" ry="14" fill="url(#m-skin)" />
    <path d="M 168 366 Q 175 360, 184 364" stroke="#5a4128" stroke-width="1.2" fill="none" opacity="0.7" />
  </g>

  <!-- Pointing arm — pivot dropped to chest height (y=268) -->
  <g
    style="transform: rotate({shoulderDeg}deg); transform-origin: {PIVOT_X}px {PIVOT_Y}px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
  >
    <path
      d="M 295 256
         C 320 252, 360 256, 395 262
         L 395 276
         C 360 282, 320 286, 295 280 Z"
      fill="url(#m-cloak-arm)"
    />
    <path d="M 305 264 C 340 266, 375 268, 392 270" stroke="#152a1d" stroke-width="1" opacity="0.5" fill="none" />
    <ellipse cx="395" cy="269" rx="11" ry="9" fill="#152a1d" opacity="0.55" />

    <g
      style="transform: rotate({forearmDeg}deg); transform-origin: 395px 269px; transform-box: view-box; transition: transform 200ms cubic-bezier(0.22, 0.8, 0.2, 1);"
    >
      <path
        d="M 392 262
           C 420 262, 470 266, 502 268
           L 502 274
           C 470 277, 420 277, 392 277 Z"
        fill="url(#m-cloak-arm)"
      />
      <path d="M 400 270 C 440 271, 480 272, 500 272" stroke="#152a1d" stroke-width="1" opacity="0.45" fill="none" />
      <path d="M 498 264 C 512 266, 516 274, 508 278 L 498 278 Z" fill="#1d3d2a" />

      <ellipse cx="513" cy="271" rx="9" ry="6.5" fill="url(#m-skin)" />
      <path d="M 508 267 Q 514 264, 520 267" stroke="#5a4128" stroke-width="0.6" fill="none" opacity="0.6" />

      <g transform="translate(519 271)">
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
