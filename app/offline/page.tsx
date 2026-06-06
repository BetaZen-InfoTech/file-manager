export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <div className="card space-y-3">
        <h1 className="text-2xl font-semibold text-white">You're offline</h1>
        <p className="text-sm text-gray-400">
          The File Manager needs a network connection to load. Reconnect, then try again.
        </p>
      </div>
    </main>
  );
}
