import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { env, s3Enabled } from '../config/env';

const UPLOAD_DIR = path.resolve('uploads');

const s3 = s3Enabled
  ? new S3Client({
      region: env.S3_REGION,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    })
  : null;

/**
 * Stores a file in S3 when configured, otherwise on local disk
 * (served under /uploads). Returns a public URL either way, so the
 * rest of the app never cares which backend is active.
 */
export async function storeFile(buffer: Buffer, mimeType: string, prefix: string): Promise<string> {
  const ext = mimeType.split('/')[1] ?? 'bin';
  const key = `${prefix}/${randomUUID()}.${ext}`;

  if (s3) {
    await s3.send(
      new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: buffer, ContentType: mimeType }),
    );
    const base = env.S3_PUBLIC_BASE_URL ?? `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com`;
    return `${base}/${key}`;
  }

  const filePath = path.join(UPLOAD_DIR, key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return `/uploads/${key}`;
}
