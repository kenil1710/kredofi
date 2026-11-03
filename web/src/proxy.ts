// Page loads on the Space address (*.hf.space) that did not come through our Cloudflare Worker go to
// https://kredofi.xyz, the one public address (rate limits key on the Worker's client IP: see
// server/clientIp.ts). API calls and static files are not redirected. Local runs are untouched.
import { NextResponse, type NextRequest } from 'next/server';
import { isSpaceHost, viaWorker } from '@/server/clientIp';
import { SITE_URL } from '@/lib/config';

export function proxy(req: NextRequest) {
  if (!process.env.PROXY_SECRET || !isSpaceHost(req.headers) || viaWorker(req.headers)) return NextResponse.next();
  if (req.method !== 'GET' && req.method !== 'HEAD') return NextResponse.next();
  return NextResponse.redirect(SITE_URL + req.nextUrl.pathname + req.nextUrl.search, 308);
}

export const config = {
  matcher: ['/((?!api/|_next/|.*\\.[a-z0-9]+$).*)'],
};
