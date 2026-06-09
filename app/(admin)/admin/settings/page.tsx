import { getSeo } from '@/lib/seo';
import { sslStatus, domainFromUrl } from '@/lib/server-control';
import ServerForm from './form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const seo = await getSeo();
  const domain = domainFromUrl(seo.canonicalBaseUrl) || '';
  const status = await sslStatus(domain);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold text-white">Domain &amp; SSL</h1>
      <p className="text-sm text-gray-400">
        Issue or renew the Let&apos;s Encrypt certificate, force HTTP→HTTPS, or point the panel at
        a new domain — all without SSH. These run a narrow, root-owned helper on the server.
      </p>
      <ServerForm initialDomain={domain} initialStatus={status} adminEmail={`admin@${domain}`} />
    </div>
  );
}
