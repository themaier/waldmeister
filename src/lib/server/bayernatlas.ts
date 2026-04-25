// BayernAtlas ALKIS Flurstück integration.
//
// Fetches parcel features from the Bavarian open-data WFS by bbox, upserts
// each result into the `parcels` cache table, and returns cached rows from
// the DB as the authoritative shape. The WFS is treated as a backfill
// source — all reads from the rest of the app go through the DB cache.
//
// The public open-data endpoint does not require authentication. We parse
// GeoJSON output (`outputFormat=application/json`) so we don't have to deal
// with GML. Property names in ALKIS vary slightly between mirrors; the
// `pickProp` helper tries a few common spellings.

import { env } from '$env/dynamic/private';
import { db } from './db';
import { forestPlots, forestPlotParcels, parcels } from './db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';

// Flurstück WFS endpoint. The LDBV "ALKIS-vereinfacht" WFS lives at
// https://geoservices.bayern.de/wfs/v1/ogc_alkis_ave.cgi and requires HTTP
// Basic auth (contract customers only — no self-service signup). We default
// to that URL but require BAYERN_WFS_USER/BAYERN_WFS_PASS to actually fetch.
const WFS_URL =
  env.BAYERN_WFS_FLURSTUECK ??
  'https://geoservices.bayern.de/wfs/v1/ogc_alkis_ave.cgi';

// Feature type name for the ALKIS-vereinfacht service. Override for INSPIRE
// or other mirrors (`cp:CadastralParcel`, `alkis:flurstueck`, etc.).
const TYPENAME = env.BAYERN_WFS_FLURSTUECK_TYPENAME ?? 'ave:Flurstueck';

const WFS_USER = env.BAYERN_WFS_USER ?? '';
const WFS_PASS = env.BAYERN_WFS_PASS ?? '';

// Max bbox area we'll honour in one fetch, in square degrees. Roughly
// ~1 km² near Bavaria's latitude. Prevents accidental country-wide pulls.
const MAX_BBOX_AREA_DEG2 = 0.02 * 0.02;

export type Bbox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

export type ParcelFeature = {
  id: string;
  cadastralId: string;
  gemarkung: string | null;
  municipality: string | null;
  areaSqm: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
};

const pickProp = (props: Record<string, unknown>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = props[k];
    if (v != null && String(v).length > 0) return String(v);
  }
  return null;
};

const pickNum = (props: Record<string, unknown>, keys: string[]): number | null => {
  for (const k of keys) {
    const v = props[k];
    if (v == null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

function assertBbox(bbox: Bbox) {
  const [w, s, e, n] = bbox;
  if (!Number.isFinite(w) || !Number.isFinite(s) || !Number.isFinite(e) || !Number.isFinite(n)) {
    throw new Error('Ungültige BBOX.');
  }
  if (w >= e || s >= n) throw new Error('Leere BBOX.');
  const area = (e - w) * (n - s);
  if (area > MAX_BBOX_AREA_DEG2) {
    throw new Error('BBOX zu groß — bitte näher heranzoomen.');
  }
}

async function fetchFromWfs(bbox: Bbox): Promise<ParcelFeature[]> {
  if (!WFS_URL) {
    throw new Error(
      'BAYERN_WFS_FLURSTUECK ist nicht konfiguriert — Flurstück-Abfragen deaktiviert.'
    );
  }
  const url = new URL(WFS_URL);
  url.searchParams.set('service', 'WFS');
  url.searchParams.set('version', '2.0.0');
  url.searchParams.set('request', 'GetFeature');
  url.searchParams.set('typeNames', TYPENAME);
  url.searchParams.set('outputFormat', 'application/json');
  url.searchParams.set('srsName', 'urn:ogc:def:crs:EPSG::4326');
  // WFS 2.0 + EPSG:4326 urn form expects lat/lon order for BBOX.
  const [w, s, e, n] = bbox;
  url.searchParams.set('bbox', `${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326`);
  url.searchParams.set('count', '500');

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (WFS_USER && WFS_PASS) {
    headers.Authorization = 'Basic ' + Buffer.from(`${WFS_USER}:${WFS_PASS}`).toString('base64');
  }

  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      'BayernAtlas-WFS lehnt die Anfrage ab — bitte BAYERN_WFS_USER/BAYERN_WFS_PASS konfigurieren.'
    );
  }
  if (!res.ok) throw new Error(`BayernAtlas WFS ${res.status}`);
  const body = (await res.json()) as {
    features?: Array<{
      id?: string;
      properties?: Record<string, unknown>;
      geometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon;
    }>;
  };

  const features: ParcelFeature[] = [];
  for (const f of body.features ?? []) {
    if (!f.geometry) continue;
    const props = f.properties ?? {};
    const cadastralId = pickProp(props, [
      'flurstkennz',
      'flurstueckskennzeichen',
      'flurstuecksnummer',
      'flstkennz',
      'kennzeichen'
    ]) ?? (f.id ? String(f.id) : null);
    if (!cadastralId) continue;
    features.push({
      id: cadastralId,
      cadastralId,
      gemarkung: pickProp(props, ['gemarkung_name', 'gmkname', 'gmk_name', 'gemarkung']),
      municipality: pickProp(props, ['gmdname', 'gemeinde_name', 'gemeindename']),
      areaSqm: pickNum(props, ['amtlicheflaeche', 'flaeche', 'amtl_flaeche']),
      geometry: f.geometry
    });
  }
  return features;
}

async function upsertCache(features: ParcelFeature[]): Promise<void> {
  if (features.length === 0) return;
  // Build one INSERT … VALUES (…), (…) ON CONFLICT DO UPDATE for a single
  // round-trip. Parameterized via sql.placeholder-less inline builds.
  const rows = features.map((f) => {
    const geomJson = JSON.stringify(f.geometry);
    return sql`(
      ${f.cadastralId},
      ${f.gemarkung},
      ${f.municipality},
      ${f.areaSqm != null ? String(f.areaSqm) : null},
      ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326),
      now()
    )`;
  });

  await db.execute(sql`
    INSERT INTO parcels
      (cadastral_id, gemarkung, municipality, area_sqm, geometry, fetched_at)
    VALUES ${sql.join(rows, sql`, `)}
    ON CONFLICT (cadastral_id) DO UPDATE SET
      gemarkung    = EXCLUDED.gemarkung,
      municipality = EXCLUDED.municipality,
      area_sqm     = EXCLUDED.area_sqm,
      geometry     = EXCLUDED.geometry,
      fetched_at   = EXCLUDED.fetched_at
  `);
}

/**
 * Return every parcel intersecting `bbox`, fetching missing ones from the
 * BayernAtlas WFS first. Results always come from the DB so callers see the
 * canonical cached row (including the stored uuid `id`).
 */
export async function listParcelsInBbox(bbox: Bbox): Promise<Array<{
  id: string;
  cadastralId: string;
  gemarkung: string | null;
  municipality: string | null;
  areaSqm: number | null;
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}>> {
  assertBbox(bbox);
  const fresh = await fetchFromWfs(bbox);
  await upsertCache(fresh);

  const [w, s, e, n] = bbox;
  const rows = await db.execute<{
    id: string;
    cadastral_id: string;
    gemarkung: string | null;
    municipality: string | null;
    area_sqm: string | null;
    geometry: string;
  }>(sql`
    SELECT
      id::text AS id,
      cadastral_id,
      gemarkung,
      municipality,
      area_sqm::text AS area_sqm,
      ST_AsGeoJSON(geometry) AS geometry
    FROM parcels
    WHERE geometry && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)
  `);

  return rows.map((r) => ({
    id: r.id,
    cadastralId: r.cadastral_id,
    gemarkung: r.gemarkung,
    municipality: r.municipality,
    areaSqm: r.area_sqm != null ? Number(r.area_sqm) : null,
    geometry: JSON.parse(r.geometry) as GeoJSON.Polygon | GeoJSON.MultiPolygon
  }));
}

/**
 * Ensure the given cadastral ids exist in the cache; returns their DB uuids.
 * If any id is missing (the client saw it in a fetch but we have no record
 * for it), we return only the ids we have — the caller decides how to react.
 */
export async function resolveParcelIds(cadastralIds: string[]): Promise<Map<string, string>> {
  if (cadastralIds.length === 0) return new Map();
  const rows = await db
    .select({ id: parcels.id, cadastralId: parcels.cadastralId })
    .from(parcels)
    .where(inArray(parcels.cadastralId, cadastralIds));
  return new Map(rows.map((r) => [r.cadastralId, r.id]));
}

/**
 * Cadastral ids from the given list that are already linked to one of
 * the user's own Waldstücke, mapped to the owning plot. A parcel may still
 * be claimed by other users' plots — those aren't returned.
 */
export async function parcelsTakenByUser(
  userId: string,
  cadastralIds: string[]
): Promise<Map<string, { plotId: string; plotName: string | null }>> {
  if (cadastralIds.length === 0) return new Map();
  const rows = await db
    .select({
      cadastralId: parcels.cadastralId,
      plotId: forestPlots.id,
      plotName: forestPlots.name
    })
    .from(forestPlotParcels)
    .innerJoin(forestPlots, eq(forestPlots.id, forestPlotParcels.plotId))
    .innerJoin(parcels, eq(parcels.id, forestPlotParcels.parcelId))
    .where(
      and(eq(forestPlots.ownerId, userId), inArray(parcels.cadastralId, cadastralIds))
    );
  return new Map(rows.map((r) => [r.cadastralId, { plotId: r.plotId, plotName: r.plotName }]));
}
