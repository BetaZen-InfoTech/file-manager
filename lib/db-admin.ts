import mongoose from 'mongoose';

/** Hide the password in a mongodb URI for display. */
export function maskMongoUri(uri: string): string {
  if (!uri) return '';
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:/@]+:)[^@]*@/i, '$1***@');
}

export interface MongoTestResult {
  ok: boolean;
  message: string;
  hasSuperAdmin: boolean;
  dbName?: string;
}

/**
 * Extract the database name from a Mongo URI's path (the segment between the
 * host and the "?"). Returns '' when absent. A path-less URI must be rejected:
 * the driver silently defaults dbName to "test", so the app would read/write
 * the wrong database without warning.
 */
export function extractDbName(uri: string): string {
  const afterHost = uri.split(/[?#]/)[0].replace(/^mongodb(\+srv)?:\/\/[^/]+/i, '');
  return afterHost.replace(/^\//, '').split('/')[0];
}

/**
 * Open a SEPARATE connection to `uri`, ping the named database, and check
 * whether it already has a super_admin (changing to an empty DB would lock the
 * admin out). The connection is always closed afterwards. Timeouts are set
 * generously so a cold/remote managed cluster (Atlas, DigitalOcean) isn't
 * falsely rejected — they must meet/exceed the live app's 10s connect timeout.
 */
export async function testMongoUri(uri: string): Promise<MongoTestResult> {
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    return { ok: false, message: 'URI must start with mongodb:// or mongodb+srv://', hasSuperAdmin: false };
  }
  const dbName = extractDbName(uri);
  if (!dbName) {
    return {
      ok: false,
      hasSuperAdmin: false,
      message:
        'URI must include a database name in the path, e.g. mongodb+srv://user:pass@cluster.mongodb.net/filemanager?retryWrites=true&w=majority'
    };
  }
  let conn: mongoose.Connection | null = null;
  try {
    conn = await mongoose
      .createConnection(uri, { serverSelectionTimeoutMS: 20_000, connectTimeoutMS: 20_000 })
      .asPromise();
    // Probe the INTENDED database explicitly — conn.db follows the driver's
    // "test" default for a path-less URI, which is not what we want to check.
    const db = conn.useDb(dbName);
    const count = await db.collection('users').countDocuments({ role: 'super_admin' }, { limit: 1 });
    return { ok: true, message: `Connection OK (db: ${dbName})`, hasSuperAdmin: count > 0, dbName };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'connection failed', hasSuperAdmin: false };
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

/** True if the app's live default connection is currently connected. */
export function liveDbConnected(): boolean {
  return mongoose.connection?.readyState === 1;
}
