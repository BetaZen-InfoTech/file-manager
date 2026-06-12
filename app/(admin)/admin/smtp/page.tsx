import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/session-server';
import SmtpClient from './smtp-client';

export const dynamic = 'force-dynamic';

export default async function SmtpPage() {
  const session = await getServerSession();
  if (!session) redirect('/login');
  if (!['super_admin', 'platform_staff'].includes(session.user.role)) redirect('/dashboard');
  const canEdit = session.user.role === 'super_admin';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-white">Email / SMTP</h1>
        <p className="mt-1 text-sm text-gray-400">
          Configure the mail server used for password resets, quota warnings, and notifications.
        </p>
      </div>
      <SmtpClient canEdit={canEdit} />
    </div>
  );
}
