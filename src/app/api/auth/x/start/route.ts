import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createOAuth2Link, defaultRedirectUri, formatXError } from "@/lib/x";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    // Always bind OAuth to the host the admin is currently on (Vercel or local).
    const redirectUri = await defaultRedirectUri(req.nextUrl.origin);
    const { url, codeVerifier, state } = await createOAuth2Link(redirectUri);

    const res = NextResponse.redirect(url);
    const secure =
      req.nextUrl.protocol === "https:" || process.env.NODE_ENV === "production";
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure,
      path: "/",
      maxAge: 60 * 10,
    };
    res.cookies.set("x_oauth_verifier", codeVerifier, cookieOpts);
    res.cookies.set("x_oauth_state", state, cookieOpts);
    res.cookies.set("x_oauth_redirect", redirectUri, cookieOpts);
    return res;
  } catch (err) {
    const message = encodeURIComponent(formatXError(err));
    return NextResponse.redirect(new URL(`/?tab=settings&xerror=${message}`, req.url));
  }
}
