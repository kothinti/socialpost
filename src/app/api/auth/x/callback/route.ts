import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { completeOAuth2Login, formatXError } from "@/lib/x";

export async function GET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  if (error) {
    const msg = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(new URL(`/?tab=settings&xerror=${msg}`, req.url));
  }

  const savedState = req.cookies.get("x_oauth_state")?.value;
  const codeVerifier = req.cookies.get("x_oauth_verifier")?.value;
  const redirectUri = req.cookies.get("x_oauth_redirect")?.value;

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.redirect(
      new URL("/?tab=settings&xerror=Missing%20OAuth%20session.%20Try%20Connect%20again.", req.url),
    );
  }

  if (state && savedState && state !== savedState) {
    return NextResponse.redirect(
      new URL("/?tab=settings&xerror=OAuth%20state%20mismatch.%20Try%20Connect%20again.", req.url),
    );
  }

  try {
    const result = await completeOAuth2Login({ code, codeVerifier, redirectUri });
    const handle = result.handle ? encodeURIComponent(result.handle) : "";
    const res = NextResponse.redirect(
      new URL(`/?tab=settings&xconnected=${handle || "1"}`, req.url),
    );
    res.cookies.delete("x_oauth_verifier");
    res.cookies.delete("x_oauth_state");
    res.cookies.delete("x_oauth_redirect");
    return res;
  } catch (err) {
    const msg = encodeURIComponent(formatXError(err));
    return NextResponse.redirect(new URL(`/?tab=settings&xerror=${msg}`, req.url));
  }
}
