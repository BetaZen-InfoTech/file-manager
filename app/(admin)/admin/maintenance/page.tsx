import { getMaintenance } from '@/lib/maintenance';
import MaintenanceForm from './form';

export const dynamic = 'force-dynamic';

export default async function MaintenancePage() {
  const m = await getMaintenance();
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold text-white">Maintenance mode</h1>
      <p className="text-sm text-gray-400">
        When enabled, only platform admins can sign in. Vendors, public links, and API calls
        return <code>503 MAINTENANCE</code>.
      </p>
      <MaintenanceForm initialEnabled={m.enabled} initialMessage={m.message} />
    </div>
  );
}
