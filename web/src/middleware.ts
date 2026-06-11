import { NextResponse, type NextRequest } from 'next/server';

/**
 * UX-only routing: the scm_role cookie (set client-side at login) sends
 * people from "/" straight to their home screen. It is NOT a security
 * boundary — every API call is authorized server-side with the JWT.
 */
export function middleware(req: NextRequest) {
  const role = req.cookies.get('scm_role')?.value;
  if (req.nextUrl.pathname === '/' && role) {
    const dest = role === 'DRIVER' ? '/driver' : role === 'ADMIN' ? '/admin' : '/passenger';
    return NextResponse.redirect(new URL(dest, req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };
