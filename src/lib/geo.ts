// Small geo helpers used on the client.

export type LngLat = [number, number]; // [lng, lat]

export function boundsOfPolygons(polygons: Array<GeoJSON.Polygon | GeoJSON.MultiPolygon>): [LngLat, LngLat] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  let found = false;

  const visitRing = (ring: GeoJSON.Position[]) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      found = true;
    }
  };

  for (const g of polygons) {
    if (g.type === 'Polygon') {
      for (const ring of g.coordinates) visitRing(ring);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) for (const ring of poly) visitRing(ring);
    }
  }

  if (!found) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat]
  ];
}

export function centerOfBounds(b: [LngLat, LngLat]): LngLat {
  return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
}

export function spanOfBoundsKm(b: [LngLat, LngLat]): number {
  // Rough haversine across the diagonal.
  const [[a1, a2], [b1, b2]] = b;
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b2 - a2);
  const dLng = toRad(b1 - a1);
  const lat1 = toRad(a2);
  const lat2 = toRad(b2);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Crude test — true when the two bounding boxes are disjoint *and* far apart. */
export function shouldFlyTo(from: [LngLat, LngLat] | null, to: [LngLat, LngLat]): boolean {
  if (!from) return false;
  const disjoint =
    from[1][0] < to[0][0] || to[1][0] < from[0][0] || from[1][1] < to[0][1] || to[1][1] < from[0][1];
  if (!disjoint) return false;
  const combined: [LngLat, LngLat] = [
    [Math.min(from[0][0], to[0][0]), Math.min(from[0][1], to[0][1])],
    [Math.max(from[1][0], to[1][0]), Math.max(from[1][1], to[1][1])]
  ];
  return spanOfBoundsKm(combined) > 5;
}
