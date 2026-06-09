import type { MetadataRoute } from 'next';
import { getSeo } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const seo = await getSeo();
  const base = seo.canonicalBaseUrl;
  const now = new Date();
  // The app is mostly authenticated; only the public marketing/login surfaces
  // belong in the sitemap. Download tokens are intentionally excluded.
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.5 }
  ];
}
