// Refresh "Größe Download" in .cache/einzelbaeume/Einzelbaumstandorte.kml from HTTP HEAD.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const kmlPath = path.join(root, '.cache', 'einzelbaeume', 'Einzelbaumstandorte.kml');
let text = readFileSync(kmlPath, 'utf8');
const codes = [...new Set([...text.matchAll(/data\/(\d+)_baeume\.gpkg/g)].map((m) => m[1]))];
let ok = 0;
let fail = 0;
for (const code of codes) {
  const url = `https://geodaten.bayern.de/odd/m/8/baeume3d/data/${code}_baeume.gpkg`;
  const res = await fetch(url, { method: 'HEAD' });
  const len = res.headers.get('content-length');
  if (!len) {
    console.error('no Content-Length:', code);
    fail++;
    continue;
  }
  const mb = (Number(len) / (1024 * 1024)).toFixed(2);
  const re = new RegExp(
    '(Größe Download:&lt;/td&gt;&lt;td&gt;)([0-9.]+)( MB &lt;td&gt;&lt;/tr&gt;\\s*&lt;tr&gt;&lt;td&gt;&lt;a href=https://geodaten\\.bayern\\.de/odd/m/8/baeume3d/data/' +
      code +
      '_baeume\\.gpkg)',
    'g'
  );
  if (!re.test(text)) {
    console.error('no KML match:', code);
    fail++;
    continue;
  }
  re.lastIndex = 0;
  text = text.replace(re, `$1${mb}$3`);
  ok++;
}
writeFileSync(kmlPath, text);
console.log(`KML sizes refreshed: ${ok} ok, ${fail} failed (${codes.length} codes)`);
