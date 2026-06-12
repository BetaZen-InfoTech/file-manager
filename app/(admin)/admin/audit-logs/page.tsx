import { dbConnect } from '@/lib/db';
import { AuditLog } from '@/models/AuditLog';
import { summarizeUA } from '@/lib/request-meta';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  await dbConnect();
  const items = await AuditLog.find({}).sort({ createdAt: -1 }).limit(200).lean();
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">Audit logs</h1>
      <p className="text-sm text-gray-400">
        Every API call is recorded with its source IP, server, request URL, location, and system.
      </p>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Action</th>
              <th className="hidden px-3 py-2 lg:table-cell">Request</th>
              <th className="hidden px-3 py-2 md:table-cell">Server</th>
              <th className="px-3 py-2">IP</th>
              <th className="hidden px-3 py-2 md:table-cell">Location</th>
              <th className="hidden px-3 py-2 lg:table-cell">System</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a: any) => {
              const loc = [a.city, a.country].filter(Boolean).join(', ');
              return (
                <tr key={String(a._id)} className="border-b border-border/60 align-top hover:bg-[#16161a]">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-gray-400">
                    {new Date(a.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-200">{a.actorEmail || a.actorType}</td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-[11px] text-accent">{a.action}</span>
                    <div className="font-mono text-[10px] text-gray-600">
                      {a.resourceType}:{a.resourceId?.slice(-8) || ''}
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 lg:table-cell">
                    <span className="rounded bg-[#1c1c20] px-1.5 py-0.5 font-mono text-[10px] text-gray-400">
                      {a.method || ''}
                    </span>{' '}
                    <span className="font-mono text-[10px] text-gray-400">{a.url || ''}</span>
                  </td>
                  <td className="hidden px-3 py-2 font-mono text-[11px] text-gray-400 md:table-cell">{a.host || ''}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-gray-300">{a.ip || ''}</td>
                  <td className="hidden px-3 py-2 text-[11px] text-gray-300 md:table-cell">
                    {loc || <span className="text-gray-600">—</span>}
                  </td>
                  <td className="hidden px-3 py-2 text-[11px] text-gray-400 lg:table-cell">{summarizeUA(a.userAgent)}</td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-gray-500">
                  No audit entries yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
