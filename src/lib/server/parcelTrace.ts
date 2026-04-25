// Trace a parcel polygon from BayernAtlas `by_label` raster tiles.
//
// The `by_label` WMTS layer renders parcel outlines (dotted/dashed reddish
// lines) and Flurstücksnummern on a transparent background. Given a click
// point, we download a 7×7 window of tiles at zoom 19, build a binary mask
// of line pixels, dilate to close gaps between the dots, flood-fill the
// interior region from the click point, trace the region's outer contour
// with the Moore-neighbour algorithm, and simplify with Douglas–Peucker
// to keep only the polygon corners.

import { PNG } from 'pngjs';

const ZOOM = 19;
const TILE = 256;
const RADIUS = 3;
const SIZE = (RADIUS * 2 + 1) * TILE;

type Pt = [number, number];

function lngLatToTilePx(lng: number, lat: number) {
  const n = 2 ** ZOOM;
  const latRad = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x, y };
}

function tilePxToLngLat(xt: number, yt: number) {
  const n = 2 ** ZOOM;
  const lng = (xt / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * yt) / n)));
  return { lng, lat: (latRad * 180) / Math.PI };
}

export async function tracePolygonAt(lng: number, lat: number): Promise<Pt[]> {
  const center = lngLatToTilePx(lng, lat);
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const minTx = cx - RADIUS;
  const minTy = cy - RADIUS;

  const lineMask = new Uint8Array(SIZE * SIZE);

  const stats = { fetched: 0, failed: 0, linePixels: 0 };
  const jobs: Promise<void>[] = [];
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      const sub = (Math.abs((tx + ty) % 3) + 1) as 1 | 2 | 3;
      const url = `https://wmtsod${sub}.bayernwolke.de/wmts/by_label/smerc/${ZOOM}/${tx}/${ty}`;
      const ox = (dx + RADIUS) * TILE;
      const oy = (dy + RADIUS) * TILE;
      jobs.push(fetchTileToMask(url, lineMask, ox, oy, stats));
    }
  }
  await Promise.all(jobs);
  console.log('[trace] tiles fetched', stats.fetched, 'failed', stats.failed, 'linePx', stats.linePixels);

  if (stats.linePixels === 0) {
    throw new Error('Keine Parzellengrenzen im Tile-Bereich gefunden (Tiles leer?).');
  }

  // Keep the un-dilated raw line mask so we can snap the traced contour to
  // the actual line at the end. Then dilate a working copy by LINE_DILATE
  // to close gaps in the dotted outlines for the flood-fill step.
  const LINE_DILATE = 2;
  const rawLineMask = new Uint8Array(lineMask);
  dilate(lineMask, SIZE, SIZE, LINE_DILATE);
  let dilatedPx = 0;
  for (let i = 0; i < lineMask.length; i++) if (lineMask[i]) dilatedPx++;
  console.log('[trace] dilated linePx', dilatedPx);

  const clickPx = {
    x: Math.round((center.x - minTx) * TILE),
    y: Math.round((center.y - minTy) * TILE)
  };
  console.log('[trace] clickPx', clickPx);
  const seed = findFreePixel(lineMask, SIZE, SIZE, clickPx.x, clickPx.y, 40);
  if (!seed) throw new Error('Keine freie Fläche in der Nähe des Klicks gefunden.');
  console.log('[trace] seed', seed);

  const fill = floodFill(lineMask, SIZE, SIZE, seed.x, seed.y);
  if (!fill) {
    throw new Error('Parzellengrenze nicht vollständig im sichtbaren Bereich — bitte näher an die Mitte der Parzelle klicken.');
  }
  let fillPx = 0;
  for (let i = 0; i < fill.length; i++) if (fill[i]) fillPx++;
  console.log('[trace] fillPx', fillPx);

  const contour = mooreTrace(fill, SIZE, SIZE);
  console.log('[trace] contour length', contour.length);
  if (contour.length < 8) throw new Error('Parzelle zu klein oder Erkennung fehlgeschlagen.');

  // Project each contour pixel outward along its local normal until it
  // hits the line. At a sharp convex corner several consecutive contour
  // points walk outward and converge on the same tip pixel, so Douglas-
  // Peucker keeps it as one vertex. The snap target is a *slightly*
  // dilated raw line (radius 1) so the 0.5-px ray can't slip between two
  // adjacent dots in a dashed outline. maxR is sized for angles as sharp
  // as ~30° (tip distance ≈ LINE_DILATE / sin(angle/2)).
  const snapMask = new Uint8Array(rawLineMask);
  dilate(snapMask, SIZE, SIZE, 1);
  const snapped = snapOutward(contour, snapMask, SIZE, SIZE, 12);

  const simplified = douglasPeucker(snapped, 2.5);
  console.log('[trace] simplified length', simplified.length);
  if (simplified.length < 3) throw new Error('Zu wenige Eckpunkte erkannt.');

  const ring: Pt[] = simplified.map(([px, py]) => {
    const ll = tilePxToLngLat(minTx + px / TILE, minTy + py / TILE);
    return [ll.lng, ll.lat];
  });
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

async function fetchTileToMask(
  url: string,
  mask: Uint8Array,
  ox: number,
  oy: number,
  stats: { fetched: number; failed: number; linePixels: number }
) {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    stats.failed++;
    console.warn('[trace] fetch failed', url, e);
    return;
  }
  if (!res.ok) {
    stats.failed++;
    console.warn('[trace] fetch not ok', url, res.status);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let png: PNG;
  try {
    png = PNG.sync.read(buf);
  } catch (e) {
    stats.failed++;
    console.warn('[trace] PNG decode failed', url, (e as Error).message);
    return;
  }
  stats.fetched++;
  const data = png.data;
  const w = png.width;
  const h = png.height;
  // Any non-transparent pixel is treated as a boundary. Text labels become
  // small internal blobs — the flood-fill flows around them and Moore
  // tracing only returns the outer contour of the filled region, so they
  // do not show up as polygon corners.
  let localCount = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 50) {
        mask[(oy + y) * SIZE + (ox + x)] = 1;
        localCount++;
      }
    }
  }
  stats.linePixels += localCount;
}

function dilate(mask: Uint8Array, w: number, h: number, r: number) {
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let v: 0 | 1 = 0;
      for (let i = x0; i <= x1; i++) {
        if (mask[row + i]) {
          v = 1;
          break;
        }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r);
      const y1 = Math.min(h - 1, y + r);
      let v: 0 | 1 = 0;
      for (let i = y0; i <= y1; i++) {
        if (tmp[i * w + x]) {
          v = 1;
          break;
        }
      }
      mask[y * w + x] = v;
    }
  }
}

function findFreePixel(
  mask: Uint8Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  maxR: number
) {
  if (cx >= 0 && cx < w && cy >= 0 && cy < h && !mask[cy * w + cx]) return { x: cx, y: cy };
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= w || y < 0 || y >= h) continue;
        if (!mask[y * w + x]) return { x, y };
      }
    }
  }
  return null;
}

function floodFill(
  lineMask: Uint8Array,
  w: number,
  h: number,
  sx: number,
  sy: number
): Uint8Array | null {
  const fill = new Uint8Array(w * h);
  const stack: number[] = [sy * w + sx];
  fill[sy * w + sx] = 1;
  let reachedEdge = false;
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx - x) / w;
    if (x === 0 || x === w - 1 || y === 0 || y === h - 1) reachedEdge = true;
    if (x > 0) {
      const n = idx - 1;
      if (!fill[n] && !lineMask[n]) {
        fill[n] = 1;
        stack.push(n);
      }
    }
    if (x < w - 1) {
      const n = idx + 1;
      if (!fill[n] && !lineMask[n]) {
        fill[n] = 1;
        stack.push(n);
      }
    }
    if (y > 0) {
      const n = idx - w;
      if (!fill[n] && !lineMask[n]) {
        fill[n] = 1;
        stack.push(n);
      }
    }
    if (y < h - 1) {
      const n = idx + w;
      if (!fill[n] && !lineMask[n]) {
        fill[n] = 1;
        stack.push(n);
      }
    }
  }
  return reachedEdge ? null : fill;
}

// Clockwise Moore-neighbour tracing with Jacob's early-stop (returning to
// the start pixel after at least one step).
function mooreTrace(fill: Uint8Array, w: number, h: number): Pt[] {
  const dx = [1, 1, 0, -1, -1, -1, 0, 1];
  const dy = [0, 1, 1, 1, 0, -1, -1, -1];

  let sx = -1;
  let sy = -1;
  outer: for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (fill[y * w + x]) {
        sx = x;
        sy = y;
        break outer;
      }
    }
  }
  if (sx < 0) return [];

  const contour: Pt[] = [[sx, sy]];
  let cx = sx;
  let cy = sy;
  let from = 4; // entered the start pixel from the west (scan found it as leftmost on its row)

  const maxSteps = 16 * (w + h);
  for (let step = 0; step < maxSteps; step++) {
    let found = -1;
    for (let k = 1; k <= 8; k++) {
      const d = (from + k) % 8;
      const nx = cx + dx[d];
      const ny = cy + dy[d];
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      if (fill[ny * w + nx]) {
        found = d;
        break;
      }
    }
    if (found < 0) break;
    cx += dx[found];
    cy += dy[found];
    from = (found + 4) % 8;
    if (cx === sx && cy === sy && contour.length > 2) break;
    contour.push([cx, cy]);
  }
  return contour;
}

// Project each contour pixel outward along the local outward normal until
// it hits a line pixel. The Moore trace runs clockwise in image-space
// (y-down), so with tangent t = next - prev, the outward normal is (ty, -tx).
// We average the tangent over a short stride so a single-pixel contour
// jitter doesn't misdirect the ray — at a corner bulge this points the
// middle pixels' rays cleanly at the corner tip. If the ray misses, fall
// back to nearest line pixel in the same window.
function snapOutward(
  contour: Pt[],
  lineMask: Uint8Array,
  w: number,
  h: number,
  maxR: number
): Pt[] {
  const N = contour.length;
  const STRIDE = Math.min(3, Math.floor(N / 4) || 1);
  const out: Pt[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const [x, y] = contour[i];
    const prev = contour[(i - STRIDE + N) % N];
    const next = contour[(i + STRIDE) % N];
    const tx = next[0] - prev[0];
    const ty = next[1] - prev[1];
    const len = Math.hypot(tx, ty);
    let hit: Pt | null = null;
    if (len > 0) {
      const nx = ty / len;
      const ny = -tx / len;
      for (let r = 0; r <= maxR; r += 0.5) {
        const px = Math.round(x + nx * r);
        const py = Math.round(y + ny * r);
        if (px < 0 || px >= w || py < 0 || py >= h) break;
        if (lineMask[py * w + px]) {
          hit = [px, py];
          break;
        }
      }
    }
    if (!hit) {
      let bestD2 = Infinity;
      for (let dy = -maxR; dy <= maxR; dy++) {
        const py = y + dy;
        if (py < 0 || py >= h) continue;
        for (let dx = -maxR; dx <= maxR; dx++) {
          const px = x + dx;
          if (px < 0 || px >= w) continue;
          if (!lineMask[py * w + px]) continue;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            hit = [px, py];
          }
        }
      }
    }
    out[i] = hit ?? [x, y];
  }
  return out;
}

function douglasPeucker(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const eps2 = eps * eps;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const lx = bx - ax;
    const ly = by - ay;
    const len2 = lx * lx + ly * ly;
    let maxD2 = 0;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d2: number;
      if (len2 === 0) {
        const ex = px - ax;
        const ey = py - ay;
        d2 = ex * ex + ey * ey;
      } else {
        let t = ((px - ax) * lx + (py - ay) * ly) / len2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = ax + t * lx - px;
        const ey = ay + t * ly - py;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > maxD2) {
        maxD2 = d2;
        maxI = i;
      }
    }
    if (maxI !== -1 && maxD2 > eps2) {
      keep[maxI] = 1;
      stack.push([a, maxI]);
      stack.push([maxI, b]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}
