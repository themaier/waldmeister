// S3-compatible storage (Cloudflare R2 / AWS S3 / MinIO).
// Upload strategy: client gets a presigned PUT URL, uploads directly.
// See README §2 for the key structure.

import { S3Client, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$env/dynamic/private';

const endpoint = env.S3_ENDPOINT;
const region = env.S3_REGION ?? 'auto';
const bucket = env.S3_BUCKET;
const accessKey = env.S3_ACCESS_KEY_ID;
const secretKey = env.S3_SECRET_ACCESS_KEY;
const forcePathStyle = env.S3_FORCE_PATH_STYLE === 'true';

let client: S3Client | null = null;
/** Shared client for presign helpers and server-side downloads (e.g. Einzelbäume mirror). */
export function getS3Client(): S3Client {
  if (client) return client;
  if (!endpoint || !accessKey || !secretKey || !bucket) {
    throw new Error('S3 is not configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY');
  }
  client = new S3Client({
    endpoint,
    region,
    forcePathStyle,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey }
  });
  return client;
}

export function treeImageKey(userId: string, treeId: string, uuid: string): string {
  return `users/${userId}/trees/${treeId}/${uuid}.jpg`;
}
export function plotImageKey(userId: string, plotId: string, uuid: string): string {
  return `users/${userId}/plots/${plotId}/${uuid}.jpg`;
}
export function areaImageKey(userId: string, areaId: string, uuid: string): string {
  return `users/${userId}/areas/${areaId}/${uuid}.jpg`;
}
export function boundaryStoneImageKey(userId: string, plotId: string, uuid: string): string {
  return `users/${userId}/plots/${plotId}/grenzsteine/${uuid}.jpg`;
}

export async function presignUpload(key: string, contentType = 'image/jpeg'): Promise<string> {
  if (!bucket) throw new Error('S3_BUCKET not set');
  const cmd = new (await import('@aws-sdk/client-s3')).PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType
  });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: 60 * 5 });
}

export async function presignDownload(key: string): Promise<string> {
  if (!bucket) throw new Error('S3_BUCKET not set');
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getS3Client(), cmd, { expiresIn: 60 * 60 });
}

export async function deleteObject(key: string): Promise<void> {
  if (!bucket) return;
  await getS3Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
