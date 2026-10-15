import type { NextRequest } from "next/server";

/**
 * The origin the browser actually used. Behind a reverse proxy (Railway, nginx
 * on a VPS) `next start -H 0.0.0.0` builds req.url from the bind address, e.g.
 * http://0.0.0.0:8080, which breaks redirects and the X OAuth callback. Proxies
 * pass the public host and scheme in X-Forwarded-* headers, so prefer those.
 */
export function publicOrigin(req: NextRequest): string {
  const first = (v: string | null) => v?.split(",")[0]?.trim() || null;
  const host = first(req.headers.get("x-forwarded-host")) || first(req.headers.get("host"));
  if (!host) return req.nextUrl.origin;
  const proto =
    first(req.headers.get("x-forwarded-proto")) || req.nextUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** Absolute URL on the public origin, for redirects. */
export function publicUrl(req: NextRequest, path: string): URL {
  return new URL(path, publicOrigin(req));
}
