import type { MetadataRoute } from 'next';
import { getSeo } from '@/lib/seo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const seo = await getSeo();
  const base = seo.canonicalBaseUrl;
  if (!seo.robotsIndex) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Never index authenticated panels, API, or private download tokens.
        disallow: ['/admin', '/dashboard', '/api/', '/d/']
      }
    ],
    sitemap: `${base}/sitemap.xml`,
    host: base
  };
}
