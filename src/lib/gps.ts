export type GpsFix = {
  lat: number;
  lng: number;
  /** Horizontal accuracy in meters (smaller is better). */
  acc: number;
  /** Timestamp (ms since epoch) when the fix was observed. */
  ts: number;
};

export type GetBetterGpsFixOptions = {
  /**
   * Minimum time to wait before resolving (lets GPS “settle” a bit).
   * The function may resolve later if it is still improving accuracy.
   */
  minWaitMs?: number;
  /** Hard timeout for the whole attempt. */
  maxWaitMs?: number;
  /**
   * If reached (after minWait), resolve immediately.
   * Keep this conservative; many phones won’t hit 2–3m quickly outdoors.
   */
  desiredAccuracyM?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Collect a "best effort" GPS fix.
 *
 * Strategy:
 * - start `watchPosition` with high accuracy
 * - keep the best (smallest `accuracy`) fix observed
 * - wait at least `minWaitMs`
 * - resolve once accuracy is good enough, or on timeout
 *
 * Returns `null` if geolocation is unavailable/denied/failed.
 */
export async function getBetterGpsFix(opts: GetBetterGpsFixOptions = {}): Promise<GpsFix | null> {
  if (!('geolocation' in navigator)) return null;
  const minWaitMs = opts.minWaitMs ?? 3000;
  const maxWaitMs = opts.maxWaitMs ?? 3500;
  const desiredAccuracyM = opts.desiredAccuracyM ?? 10;

  const start = Date.now();
  const minDoneAt = start + minWaitMs;
  const hardStopAt = start + maxWaitMs;

  let best: GpsFix | null = null;
  let watchId: number | null = null;

  try {
    // Ensure we never resolve before minWaitMs.
    const minWait = sleep(minWaitMs);

    const result = await new Promise<GpsFix | null>((resolve) => {
      let resolved = false;
      const finish = (fix: GpsFix | null) => {
        if (resolved) return;
        resolved = true;
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        resolve(fix);
      };

      const tick = () => {
        const now = Date.now();
        if (now >= hardStopAt) return finish(best);
        if (now >= minDoneAt && best && best.acc <= desiredAccuracyM) return finish(best);
        setTimeout(tick, 125);
      };

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const fix: GpsFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
            ts: pos.timestamp ? Number(pos.timestamp) : Date.now()
          };
          if (!best || fix.acc < best.acc) best = fix;
        },
        () => finish(null),
        {
          enableHighAccuracy: true,
          maximumAge: 0
        }
      );

      tick();
    });

    // Enforce minimum wait even if the browser errors quickly (UX consistency).
    await minWait;
    return result;
  } catch {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    return null;
  }
}

