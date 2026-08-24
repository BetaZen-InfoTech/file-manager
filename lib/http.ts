import { NextResponse } from 'next/server';

export function jsonError(
  code: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: { code, message, ...(extra || {}) } }, { status });
}

export function jsonOk<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function notFound(message = 'Not found'): NextResponse {
  return jsonError('NOT_FOUND', message, 404);
}
export function forbidden(message = 'Forbidden'): NextResponse {
  return jsonError('FORBIDDEN', message, 403);
}
export function unauthorized(message = 'Unauthorized'): NextResponse {
  return jsonError('UNAUTHORIZED', message, 401);
}
export function badRequest(message = 'Bad request', extra?: Record<string, unknown>): NextResponse {
  return jsonError('BAD_REQUEST', message, 400, extra);
}
export function maintenance(message: string): NextResponse {
  return jsonError('MAINTENANCE', message, 503);
}
export function internalError(message = 'Something went wrong. Please try again.'): NextResponse {
  return jsonError('INTERNAL', message, 500);
}
export function dbUnavailable(
  message = 'Database connection error. The service is temporarily unavailable — please try again in a moment.'
): NextResponse {
  return jsonError('DB_UNAVAILABLE', message, 503);
}

/**
 * True when an error is a MongoDB/Mongoose connectivity failure (server down,
 * unreachable, auth/DNS failure, or a query that timed out because there is no
 * live connection). Lets route handlers return a clear DB_UNAVAILABLE 503 instead
 * of an opaque empty-body 500 when the database is down.
 */
export function isDbConnectionError(err: unknown): boolean {
  const e = err as { name?: string; message?: string; code?: string } | null | undefined;
  if (!e) return false;
  const name = e.name || '';
  const msg = String(e.message || '');
  if (
    name === 'MongooseServerSelectionError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoNotConnectedError'
  ) {
    return true;
  }
  // Mongoose buffering timeout (a query issued while disconnected) + raw socket errors.
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|failed to connect|buffering timed out|server selection|topology (was destroyed|is closed)|connection .*closed/i.test(
    msg
  );
}
export function suspended(): NextResponse {
  return jsonError('VENDOR_SUSPENDED', 'This vendor is suspended.', 403);
}
export function quotaExceeded(): NextResponse {
  return jsonError('QUOTA_EXCEEDED', 'Storage quota exceeded.', 413);
}

/**
 * Strict Mongo ObjectId check (24 hex chars). Use to guard any id that flows from
 * the client into a Mongoose query — an un-castable value makes Mongoose throw a
 * CastError which, uncaught, becomes an opaque empty-body 500. Stricter than
 * mongoose.isValidObjectId (which also accepts 12-char strings and numbers).
 */
export function isObjectIdHex(v: unknown): v is string {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

export async function safeParseJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
