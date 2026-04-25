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
  /**
   * Use browser-cached positions up to this age (ms). Useful to avoid repeated
   * sensor wakeups when the user taps multiple times quickly.
   *
   * Default: 0 (fresh fix).
   */
  maximumAgeMs?: number;
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
  if (typeof window === 'undefined') return null;
  // Geolocation is only available in secure contexts (https / localhost).
  if (!window.isSecureContext) return null;
  if (!('geolocation' in navigator)) return null;

  // NOTE: do NOT `await navigator.permissions.query(...)` here. On iOS Safari
  // the geolocation prompt only appears when getCurrentPosition/watchPosition
  // is called synchronously inside a user-gesture handler; an `await` before
  // the call drops that activation and Safari silently auto-denies. The
  // PERMISSION_DENIED error path below covers the already-denied case.

  const minWaitMs = opts.minWaitMs ?? 3000;
  const maxWaitMs = opts.maxWaitMs ?? 3500;
  const desiredAccuracyM = opts.desiredAccuracyM ?? 10;
  const maximumAgeMs = opts.maximumAgeMs ?? 0;

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
        // Tolerate transient errors (POSITION_UNAVAILABLE / TIMEOUT) — these are
        // common right after a previous watch was cleared and the GPS often
        // recovers within the timeout window. Only bail out on PERMISSION_DENIED.
        (err) => {
          if (err.code === err.PERMISSION_DENIED) finish(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: maximumAgeMs,
          timeout: Math.max(250, maxWaitMs)
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

