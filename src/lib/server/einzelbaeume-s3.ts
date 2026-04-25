// Mirrors official Einzelbäume assets from S3 into a local directory so
// better-sqlite3 / bun:sqlite can open GeoPackages by file path.

import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { env } from '$env/dynamic/private';
import { getS3Client } from './s3';

const EINZELBAEUME_SUFFIXES = ['.gpkg', '.kml'];

function normalizePrefix(p: string): string {
  const t = p.trim();
  return t.endsWith('/') ? t : `${t}/`;
}

let mirrorPromise: Promise<string> | null = null;

/** One sync per process; restart the server after adding or replacing objects in the bucket. */
export function ensureEinzelbaeumeMirrorFromS3(): Promise<string> {
  if (!mirrorPromise) mirrorPromise = syncMirrorOnce();
  return mirrorPromise;
}

async function syncMirrorOnce(): Promise<string> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET not set');

  const prefix = normalizePrefix(env.S3_EINZELBAEUME_PREFIX ?? 'einzelbaeume');
  const mirror =
    env.BAYERN_EINZELBAEUME_LOCAL_MIRROR ??
    path.join(tmpdir(), 'waldmeister-einzelbaeume');

  await mkdir(mirror, { recursive: true });

  const client = getS3Client();
  let continuationToken: string | undefined;

  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );
    continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;

    for (const obj of out.Contents ?? []) {
      const key = obj.Key;
      const size = obj.Size;
      if (!key || size == null) continue;
      const lower = key.toLowerCase();
      if (!EINZELBAEUME_SUFFIXES.some((s) => lower.endsWith(s))) continue;

      const rel = key.slice(prefix.length).replace(/^\/+/, '');
      if (!rel || rel.includes('..')) continue;
      const dest = path.join(mirror, ...rel.split('/'));

      let need = true;
      try {
        const st = await stat(dest);
        if (st.size === size) need = false;
      } catch {
        need = true;
      }
      if (!need) continue;

      await mkdir(path.dirname(dest), { recursive: true });
      const tmpDest = `${dest}.tmp-${process.pid}`;
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error(`Leerer S3-Body für ${key}`);
      await pipeline(res.Body as NodeJS.ReadableStream, createWriteStream(tmpDest));
      await rename(tmpDest, dest);
    }
  } while (continuationToken);

  return mirror;
}
