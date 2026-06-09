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
}

/**
 * Open a SEPARATE connection to `uri`, ping it, and check whether the target
 * database already has a super_admin (changing to an empty DB would lock the
 * admin out). The connection is always closed afterwards.
 */
export async function testMongoUri(uri: string): Promise<MongoTestResult> {
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    return { ok: false, message: 'URI must start with mongodb:// or mongodb+srv://', hasSuperAdmin: false };
  }
  let conn: mongoose.Connection | null = null;
  try {
    conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 6000 }).asPromise();
    const db = conn.db;
    if (!db) return { ok: false, message: 'connected but no database in URI', hasSuperAdmin: false };
    const count = await db.collection('users').countDocuments({ role: 'super_admin' }, { limit: 1 });
    return { ok: true, message: 'Connection OK', hasSuperAdmin: count > 0 };
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
