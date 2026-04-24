// Helpers for the PostGIS `geometry(Polygon|LineString|Point, 4326)` columns.
// Drizzle doesn't know about geometry, so we read/write via raw SQL fragments.

import { sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/** INSERT/UPDATE: wrap a GeoJSON object as an EPSG:4326 geometry. */
export const geoJsonToGeom = (geojson: unknown) =>
  sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geojson)}), 4326)`;

/** SELECT: render a geometry column back to a GeoJSON string. */
export const geomToGeoJson = (column: AnyColumn) => sql`ST_AsGeoJSON(${column})`;

/** Point-in-polygon test — returns `trees` rows that sit inside `polygonGeoJson`. */
export const treeInsideArea = (polygonGeoJson: unknown) =>
  sql`ST_Contains(${geoJsonToGeom(polygonGeoJson)}, ST_SetSRID(ST_MakePoint(trees.longitude::float, trees.latitude::float), 4326))`;
