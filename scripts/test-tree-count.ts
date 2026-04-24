// Smoke test the tree-count pipeline with no SvelteKit aliases.
// Run with:
//   /c/Users/Tobias/.bun/bin/bun.exe run scripts/test-tree-count.ts <plotId> <ownerId>

import postgres from 'postgres';
import Database from 'better-sqlite3';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import proj4 from 'proj4';

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs +type=crs');

const url = process.env.DATABASE_URL ?? 'postgres://waldmeister:waldmeister@localhost:5432/waldmeister';
const sql = postgres(url);

const [, , plotId, ownerId] = process.argv;
if (!plotId || !ownerId) {
  console.error('Usage: bun run scripts/test-tree-count.ts <plotId> <ownerId>');
  process.exit(2);
}

type Position = [number, number];
type PolygonCoordinates = Position[][];
type PlotGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

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
function containsPoint(g: PlotGeometry, p: Position): boolean {
  if (g.type === 'Polygon') return isPointInPolygon(p, g.coordinates);
  return g.coordinates.some((poly) => isPointInPolygon(p, poly));
}
function bounds(g: PlotGeometry): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const visit = (p: Position) => {
    minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
  };
  if (g.type === 'Polygon') g.coordinates.flat().forEach(visit);
  else g.coordinates.flat(2).forEach(visit);
  return [minX, minY, maxX, maxY];
}

const rows = await sql<{ geometry_utm: string; centroid_wgs84: string; area_ha: number }[]>`
  SELECT
    ST_AsGeoJSON(ST_Transform(ST_UnaryUnion(ST_Collect(p.geometry)), 25832)) AS geometry_utm,
    ST_AsGeoJSON(ST_Centroid(ST_UnaryUnion(ST_Collect(p.geometry)))) AS centroid_wgs84,
    (ST_Area(ST_Transform(ST_UnaryUnion(ST_Collect(p.geometry)), 25832)) / 10000.0)::float AS area_ha
  FROM forest_plots fp
  JOIN forest_plot_parcels fpp ON fpp.plot_id = fp.id
  JOIN parcels p ON p.id = fpp.parcel_id
  WHERE fp.id = ${plotId}::uuid AND fp.owner_id = ${ownerId}
  GROUP BY fp.id
`;
const row = rows[0];
if (!row?.geometry_utm) { console.error('No geometry'); process.exit(1); }
const geom = JSON.parse(row.geometry_utm) as PlotGeometry;
console.log('area_ha:', row.area_ha, 'utm bounds:', bounds(geom));

const dir = path.join(process.cwd(), '.cache', 'einzelbaeume');
const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.gpkg'));
console.log('gpkg files:', files);

let total = 0;
for (const file of files) {
  const filePath = path.join(dir, file);
  const dbf = new Database(filePath, { readonly: true, fileMustExist: true });
  const ext = dbf.prepare(`SELECT min(min_x) min_x, min(min_y) min_y, max(max_x) max_x, max(max_y) max_y FROM gpkg_contents WHERE data_type='features'`).get() as any;
  const [minX, minY, maxX, maxY] = bounds(geom);
  const intersects = ext && ext.max_x >= minX && ext.min_x <= maxX && ext.max_y >= minY && ext.min_y <= maxY;
  console.log(' ', file, 'extent', ext, 'intersects:', intersects);
  if (!intersects) { dbf.close(); continue; }
  const tables = dbf.prepare(`SELECT table_name FROM gpkg_contents WHERE data_type='features' AND max_x>=? AND min_x<=? AND max_y>=? AND min_y<=?`).all(minX, maxX, minY, maxY) as { table_name: string }[];
  console.log('   matching tables:', tables.map((t) => t.table_name));
  for (const { table_name } of tables) {
    const pkInfo = dbf.prepare(`PRAGMA table_info("${table_name}")`).all() as { name: string; pk: number }[];
    const pk = pkInfo.find((c) => c.pk > 0)?.name ?? 'fid';
    const rs = dbf.prepare(`SELECT r.id AS id, r.minx AS x, r.miny AS y, t.baumhoehe AS h FROM "rtree_${table_name}_geom" r JOIN "${table_name}" t ON t.${pk}=r.id WHERE r.maxx>=? AND r.minx<=? AND r.maxy>=? AND r.miny<=? AND t.baumhoehe>=?`).all(minX, maxX, minY, maxY, 2) as { id: number; x: number; y: number; h: number | null }[];
    let inside = 0;
    for (const r of rs) if (containsPoint(geom, [Number(r.x), Number(r.y)])) inside++;
    console.log('     table', table_name, 'rtreeHits:', rs.length, 'inside:', inside);
    total += inside;
  }
  dbf.close();
}
console.log('TOTAL:', total);
await sql.end();
