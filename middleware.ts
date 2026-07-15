import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const publicRoutes = ['/login', '/forgot-password', '/reset-password', '/setup'];

function isPublicPath(pathname: string) {
  return publicRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith('/api/');
  const isSetupApi = pathname.startsWith('/api/setup/');
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);

  if (isApi && isWrite) {
    const fetchSite = request.headers.get('sec-fetch-site');
    const origin = request.headers.get('origin');
    if (fetchSite === 'cross-site' || (origin && fetchSite !== 'same-origin' && origin !== request.nextUrl.origin)) {
      return NextResponse.json(
        { success: false, error: 'cross-site-request-blocked' },
        { status: 403, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      );
    }
  }

  if (!url || !key) {
    if (isApi && !isSetupApi) {
      return NextResponse.json({ success: false, error: 'database-unavailable' }, { status: 401 });
    }
    if (!isApi && !isPublicPath(pathname)) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = '/login';
      redirect.searchParams.set('next', pathname);
      return NextResponse.redirect(redirect);
    }
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options) {
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options) {
        response.cookies.set({ name, value: '', ...options });
      }
    }
  });

  const { data } = await supabase.auth.getUser();
  if (!data.user && isApi && !isSetupApi) {
    return NextResponse.json({ success: false, error: 'authentication-required' }, { status: 401 });
  }

  if (!data.user && !isApi && !isPublicPath(pathname)) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/login';
    redirect.searchParams.set('next', pathname);
    return NextResponse.redirect(redirect);
  }

  if (data.user && (pathname === '/login' || pathname === '/forgot-password')) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = '/';
    redirect.search = '';
    return NextResponse.redirect(redirect);
  }

  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return response;
}

export const config = {
  matcher: [
    '/',
    '/documents/:path*',
    '/collections/:path*',
    '/tenancies/:path*',
    '/commercial/:path*',
    '/property-intelligence/:path*',
    '/property-analysis/:path*',
    '/property-comparables/:path*',
    '/property-nearby/:path*',
    '/property-score/:path*',
    '/property-map/:path*',
    '/admin/:path*',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/setup',
    '/api/:path*'
  ]
};
