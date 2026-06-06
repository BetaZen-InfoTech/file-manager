import JwtIssuer from './jwt-issuer';

export const dynamic = 'force-dynamic';

export default function JwtPage() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-white">3rd-party JWT</h1>
      <p className="text-sm text-gray-400">
        Issue scoped, time-bound JWTs to partner systems. Use them for private link access
        (<code>/d/:token</code>) and authorized API calls.
      </p>
      <JwtIssuer />
    </div>
  );
}
