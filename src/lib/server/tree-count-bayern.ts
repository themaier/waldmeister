// Reads official Einzelbäume points from local Bavarian GeoPackages and
// returns the ones that fall inside a single Waldstück (the user's active
// plot). We never load all trees of a region — the rtree index in the
// GeoPackage is queried with the plot's UTM bounding box, then points are
// re-tested with a precise polygon containment check.

import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { sql } from 'drizzle-orm';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';
import { ensureEinzelbaeumeMirrorFromS3 } from './einzelbaeume-s3';
import { openReadOnlySqlite, type SqliteHandle } from './sqlite-driver';

const DEFAULT_MIN_HEIGHT_M = 2;

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs');

type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = PolygonCoordinates[];
type PlotGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: MultiPolygonCoordinates };

export type OfficialTreeDot = {
  id: string;
  longitude: number;
  latitude: number;
  heightM: number | null;
};

async function resolvedDataDir(): Promise<string> {
  if (env.BAYERN_EINZELBAEUME_DATA_DIR) return env.BAYERN_EINZELBAEUME_DATA_DIR;
  const s3Configured = Boolean(
    env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
  );
  if (s3Configured) return ensureEinzelbaeumeMirrorFromS3();
  return path.join(process.cwd(), '.cache', 'einzelbaeume');
}

function isPointInRing(point: Position, ring: Position[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInPolygon(point: Position, rings: PolygonCoordinates): boolean {
  if (rings.length === 0 || !isPointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((hole) => isPointInRing(point, hole));
}

function containsPoint(geometry: PlotGeometry, point: Position): boolean {
  if (geometry.type === 'Polygon') return isPointInPolygon(point, geometry.coordinates);
  return geometry.coordinates.some((polygon) => isPointInPolygon(point, polygon));
}

function boundsOfGeometry(geometry: PlotGeometry): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = ([x, y]: Position) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  if (geometry.type === 'Polygon') geometry.coordinates.flat().forEach(visit);
  else geometry.coordinates.flat(2).forEach(visit);
  return [minX, minY, maxX, maxY];
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

async function getPlotGeometryUtm(plotId: string, ownerId: string): Promise<PlotGeometry> {
  const rows = await db.execute<{ geometry_utm: string }>(sql`
    SELECT
      ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(p.geometry)), 25832)) AS geometry_utm
    FROM forest_plots fp
    JOIN forest_plot_parcels fpp ON fpp.plot_id = fp.id
    JOIN parcels p ON p.id = fpp.parcel_id
    WHERE fp.id = ${plotId}::uuid
      AND fp.owner_id = ${ownerId}
    GROUP BY fp.id
  `);
  const row = rows[0];
  if (!row?.geometry_utm) {
    throw new Error('Waldstück nicht gefunden oder ohne Flurstück-Geometrie.');
  }
  return JSON.parse(row.geometry_utm) as PlotGeometry;
}

// Find every `*_baeume.gpkg` whose declared extent intersects the plot's
// bbox. With S3 configured, files are mirrored once per process from
// `S3_EINZELBAEUME_PREFIX` (default `einzelbaeume/`). Otherwise use
// `BAYERN_EINZELBAEUME_DATA_DIR` or `.cache/einzelbaeume/`.
async function findGeoPackagesForBounds(bounds: [number, number, number, number]): Promise<string[]> {
  const dir = await resolvedDataDir();
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.toLowerCase().endsWith('.gpkg'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }

  const [minX, minY, maxX, maxY] = bounds;
  const matches: string[] = [];
  for (const file of files) {
    const filePath = path.join(dir, file);
    const handle = await openReadOnlySqlite(filePath);
    try {
      const row = handle
        .prepare(
          `SELECT min(min_x) AS min_x, min(min_y) AS min_y, max(max_x) AS max_x, max(max_y) AS max_y
           FROM gpkg_contents
           WHERE data_type = 'features'`
        )
        .get() as { min_x: number; min_y: number; max_x: number; max_y: number } | undefined;
      if (!row) continue;
      if (row.max_x >= minX && row.min_x <= maxX && row.max_y >= minY && row.min_y <= maxY) {
        matches.push(filePath);
      }
    } finally {
      handle.close();
    }
  }
  return matches;
}

function featureTablesIntersecting(
  handle: SqliteHandle,
  bounds: [number, number, number, number]
): string[] {
  const [minX, minY, maxX, maxY] = bounds;
  const rows = handle
    .prepare(
      `SELECT table_name
       FROM gpkg_contents
       WHERE data_type = 'features'
         AND max_x >= ? AND min_x <= ?
         AND max_y >= ? AND min_y <= ?
       ORDER BY table_name`
    )
    .all(minX, maxX, minY, maxY) as { table_name: string }[];
  return rows.map((r) => r.table_name);
}

function primaryKeyColumn(handle: SqliteHandle, table: string): string {
  const info = handle
    .prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    .all() as { name: string; pk: number }[];
  return info.find((row) => row.pk > 0)?.name ?? 'fid';
}

async function dotsFromGeoPackage(
  gpkgPath: string,
  geometryUtm: PlotGeometry,
  minHeightM: number
): Promise<OfficialTreeDot[]> {
  const bounds = boundsOfGeometry(geometryUtm);
  const [minX, minY, maxX, maxY] = bounds;
  const handle = await openReadOnlySqlite(gpkgPath);
  const dots: OfficialTreeDot[] = [];
  try {
    for (const table of featureTablesIntersecting(handle, bounds)) {
      const treeTable = quoteIdent(table);
      const rtreeTable = quoteIdent(`rtree_${table}_geom`);
      const pkCol = quoteIdent(primaryKeyColumn(handle, table));
      const rows = handle
        .prepare(
          `SELECT r.id AS id, r.minx AS x, r.miny AS y, t.baumhoehe AS baumhoehe
           FROM ${rtreeTable} r
           JOIN ${treeTable} t ON t.${pkCol} = r.id
           WHERE r.maxx >= ? AND r.minx <= ?
             AND r.maxy >= ? AND r.miny <= ?
             AND t.baumhoehe >= ?`
        )
        .all(minX, maxX, minY, maxY, minHeightM) as {
          id: number;
          x: number;
          y: number;
          baumhoehe: number | null;
        }[];

      const fileTag = path.basename(gpkgPath);
      for (const row of rows) {
        const x = Number(row.x);
        const y = Number(row.y);
        if (!containsPoint(geometryUtm, [x, y])) continue;
        const [longitude, latitude] = proj4('EPSG:25832', 'EPSG:4326', [x, y]);
        dots.push({
          id: `${fileTag}:${table}:${row.id}`,
          longitude,
          latitude,
          heightM: row.baumhoehe == null ? null : Number(row.baumhoehe)
        });
      }
    }
  } finally {
    handle.close();
  }
  return dots;
}

export async function listOfficialTreeDotsForPlot(
  plotId: string,
  ownerId: string,
  options: { minHeightM?: number } = {}
): Promise<{ dots: OfficialTreeDot[] }> {
  const minHeightM = options.minHeightM ?? DEFAULT_MIN_HEIGHT_M;
  const geometryUtm = await getPlotGeometryUtm(plotId, ownerId);
  const gpkgPaths = await findGeoPackagesForBounds(boundsOfGeometry(geometryUtm));
  const perFile = await Promise.all(
    gpkgPaths.map((gpkgPath) => dotsFromGeoPackage(gpkgPath, geometryUtm, minHeightM))
  );
  return { dots: perFile.flat() };
}
