import { NextRequest, NextResponse } from 'next/server';

// Next.js middleware runs at the Edge runtime — Mongoose/argon2 are NOT available here.
// Authentication + suspension + maintenance enforcement happens inside route handlers
// (where we have full Node.js + DB access). Middleware just:
//   1. Adds security headers
//   2. Forwards client IP via X-Forwarded-For (so audit logs can record it)
//   3. Adds a request id for tracing

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  // Security headers are set by next.config.js — middleware only adds the trace id
  res.headers.set('X-Request-Id', crypto.randomUUID());
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)']
};
