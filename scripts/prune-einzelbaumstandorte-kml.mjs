// Prune the Einzelbaumstandorte KML catalog down to a small set of tiles.
// Keeps header/styles intact, but removes all other <Placemark> entries.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const keepCodes = new Set(['124013', '124019', '124020']);

const kmlPath = path.join(process.cwd(), '.cache', 'einzelbaeume', 'Einzelbaumstandorte.kml');
const input = readFileSync(kmlPath, 'utf8');

const placemarks = [...input.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g)];
if (placemarks.length === 0) {
  throw new Error(`No <Placemark> elements found in ${kmlPath}`);
}

const firstStart = placemarks[0].index ?? 0;
const last = placemarks[placemarks.length - 1];
const lastStart = last.index ?? 0;
const lastEnd = lastStart + last[0].length;

const prefix = input.slice(0, firstStart);
const suffix = input.slice(lastEnd);

const kept = placemarks
  .map((m) => m[0])
  .filter((block) => {
    const m = block.match(/data\/(\d+)_baeume\.gpkg/i);
    if (!m) return false;
    return keepCodes.has(m[1]);
  });

if (kept.length === 0) {
  throw new Error(`No matching placemarks kept (wanted: ${[...keepCodes].join(', ')})`);
}

const output = `${prefix}${kept.join('\n')}${suffix}`;
writeFileSync(kmlPath, output);

console.log(`Pruned KML placemarks: kept ${kept.length} of ${placemarks.length}`);

