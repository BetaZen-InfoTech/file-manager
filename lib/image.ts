import sharp from 'sharp';
import { storage } from './storage';

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/tiff'
]);

export interface ImageMeta {
  width: number;
  height: number;
}

export async function extractImageMeta(buf: Buffer, mimeType: string): Promise<ImageMeta | null> {
  if (!IMAGE_MIMES.has(mimeType)) return null;
  try {
    const meta = await sharp(buf).metadata();
    return { width: meta.width || 0, height: meta.height || 0 };
  } catch {
    return null;
  }
}

export interface ThumbResult {
  size: 'sm' | 'md';
  storageKey: string;
  width: number;
  height: number;
}

const THUMB_SIZES: { size: 'sm' | 'md'; max: number }[] = [
  { size: 'sm', max: 160 },
  { size: 'md', max: 480 }
];

export async function generateThumbnails(
  originalBuf: Buffer,
  mimeType: string,
  baseKey: string
): Promise<ThumbResult[]> {
  if (!IMAGE_MIMES.has(mimeType)) return [];
  const out: ThumbResult[] = [];
  for (const t of THUMB_SIZES) {
    try {
      const buf = await sharp(originalBuf)
        .rotate()
        .resize({ width: t.max, height: t.max, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const meta = await sharp(buf).metadata();
      const key = `${baseKey}.thumb-${t.size}.webp`;
      await storage.putObject(key, buf, { mimeType: 'image/webp' });
      out.push({ size: t.size, storageKey: key, width: meta.width || 0, height: meta.height || 0 });
    } catch {
      // best-effort — skip failures
    }
  }
  return out;
}
