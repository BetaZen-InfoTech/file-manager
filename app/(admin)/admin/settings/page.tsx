import { getSeo } from '@/lib/seo';
import { sslStatus, domainFromUrl } from '@/lib/server-control';
import { getEnvValue } from '@/lib/env-file';
import { maskMongoUri, liveDbConnected } from '@/lib/db-admin';
import ServerForm from './form';
import DatabaseForm from './database-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const seo = await getSeo();
  const domain = domainFromUrl(seo.canonicalBaseUrl) || '';
  const status = await sslStatus(domain);
  const maskedUri = maskMongoUri(getEnvValue('MONGODB_URI'));
  const dbConnected = liveDbConnected();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <section className="space-y-5">
        <h1 className="text-2xl font-semibold text-white">Domain &amp; SSL</h1>
        <p className="text-sm text-gray-400">
          Issue or renew the Let&apos;s Encrypt certificate, force HTTP→HTTPS, or point the panel at
          a new domain — all without SSH. These run a narrow, root-owned helper on the server.
        </p>
        <ServerForm initialDomain={domain} initialStatus={status} adminEmail={`admin@${domain}`} />
      </section>

      <section className="space-y-5">
        <h2 className="text-xl font-semibold text-white">Database (MongoDB)</h2>
        <p className="text-sm text-gray-400">
          Change the MongoDB connection string. It&apos;s tested before being saved; the panel then
          reloads to apply. <span className="text-yellow-400">Switching to an empty database can lock
          you out</span> — make sure it has a super_admin or seed one after.
        </p>
        <DatabaseForm maskedUri={maskedUri} connected={dbConnected} />
      </section>
    </div>
  );
}
