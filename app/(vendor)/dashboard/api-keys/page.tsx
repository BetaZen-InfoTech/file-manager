import { dbConnect } from '@/lib/db';
import { ApiKey } from '@/models/ApiKey';
import { getServerSession } from '@/lib/session-server';
import ApiKeyManager from './api-key-manager';

export const dynamic = 'force-dynamic';

export default async function ApiKeysPage() {
  const session = await getServerSession();
  if (!session?.vendor) return null;
  await dbConnect();
  const items = await ApiKey.find({ vendorId: session.vendor.id })
    .sort({ createdAt: -1 })
    .select('-keyHash')
    .lean();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">API keys</h1>
      <p className="text-sm text-gray-400">
        Keys carry RBAC scopes. The plain key is shown only once when created.
      </p>
      <ApiKeyManager initial={JSON.parse(JSON.stringify(items))} />
    </div>
  );
}
