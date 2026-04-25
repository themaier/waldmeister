// Uploads `.cache/einzelbaeume/*` to S3 under prefix `einzelbaeume/` (override with S3_EINZELBAEUME_PREFIX).
// Run from repo root: node ./scripts/upload-einzelbaeume-to-s3.mjs
// Loads `.env` if present (does not override existing process.env).

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const p = path.join(process.cwd(), '.env');
  if (!existsSync(p)) return;
  const text = readFileSync(p, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function req(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function normalizePrefix(p) {
  const t = p.trim();
  return t.endsWith('/') ? t : `${t}/`;
}

async function main() {
  loadDotEnv();

  const endpoint = req('S3_ENDPOINT');
  const region = process.env.S3_REGION ?? 'auto';
  const bucket = req('S3_BUCKET');
  const accessKeyId = req('S3_ACCESS_KEY_ID');
  const secretAccessKey = req('S3_SECRET_ACCESS_KEY');
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';
  const prefix = normalizePrefix(process.env.S3_EINZELBAEUME_PREFIX ?? 'einzelbaeume');

  const localDir = path.join(process.cwd(), '.cache', 'einzelbaeume');
  const names = readdirSync(localDir).filter((f) => /\.(gpkg|kml)$/i.test(f));
  if (names.length === 0) {
    console.error(`No .gpkg / .kml files in ${localDir}`);
    process.exit(1);
  }

  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey }
  });

  for (const name of names) {
    const filePath = path.join(localDir, name);
    const key = `${prefix}${name}`;
    const size = statSync(filePath).size;
    process.stdout.write(`Uploading ${name} (${size} bytes) → ${key} … `);
    const body = createReadStream(filePath);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: size
      })
    );
    console.log('ok');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
