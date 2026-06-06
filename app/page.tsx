import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-12 text-center">
      <div className="w-full max-w-xl space-y-6">
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          File Manager
        </h1>
        <p className="text-gray-400">
          Multi-tenant file storage with buckets, RBAC, API keys, and 3 link types
          (public / private / temporary). Next.js + MongoDB + MinIO.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/login" className="btn w-full sm:w-auto">
            Sign in
          </Link>
          <a
            href="/docs"
            className="btn-secondary w-full sm:w-auto"
            rel="noreferrer"
          >
            API docs
          </a>
        </div>
        <p className="pt-4 text-xs text-gray-500">
          Admin and vendor portals use the same login.
        </p>
      </div>
    </main>
  );
}
