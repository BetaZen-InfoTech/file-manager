import { dbConnect } from '@/lib/db';
import { AuditLog } from '@/models/AuditLog';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await dbConnect();
  const items = await AuditLog.find({}).sort({ createdAt: -1 }).limit(200).lean();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Audit logs</h1>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
              <th className="hidden md:table-cell">IP</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={String(a._id)}>
                <td className="font-mono text-xs">
                  {new Date(a.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                </td>
                <td className="text-xs">{a.actorEmail || a.actorType}</td>
                <td className="font-mono text-xs">{a.action}</td>
                <td className="font-mono text-xs">
                  {a.resourceType}:{a.resourceId?.slice(-8) || ''}
                </td>
                <td className="hidden md:table-cell font-mono text-xs">{a.ip || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
