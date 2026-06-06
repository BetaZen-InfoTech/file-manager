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
export function suspended(): NextResponse {
  return jsonError('VENDOR_SUSPENDED', 'This vendor is suspended.', 403);
}
export function quotaExceeded(): NextResponse {
  return jsonError('QUOTA_EXCEEDED', 'Storage quota exceeded.', 413);
}

export async function safeParseJson<T = unknown>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
