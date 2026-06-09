import { getSeo } from '@/lib/seo';
import SeoForm from './form';

export const dynamic = 'force-dynamic';

export default async function SeoPage() {
  const seo = await getSeo();
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold text-white">SEO &amp; site metadata</h1>
      <p className="text-sm text-gray-400">
        Controls page titles, meta description, social-share preview (Open Graph / Twitter),
        favicon, theme color, the robots directive, and <code>/sitemap.xml</code>. Changes apply
        site-wide within ~10s.
      </p>
      <SeoForm initial={seo} />
    </div>
  );
}
