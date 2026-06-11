import ResetForm from './form';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage({
  searchParams
}: {
  searchParams: { token?: string };
}) {
  return <ResetForm token={searchParams?.token || ''} />;
}
