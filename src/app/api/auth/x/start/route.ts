import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createOAuth2Link, defaultRedirectUri, formatXError } from "@/lib/x";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const redirectUri = defaultRedirectUri(req.nextUrl.origin);
    const callbackOrigin = new URL(redirectUri).origin;
    const currentOrigin = req.nextUrl.origin;

    // Cookies for PKCE must be set on the same host X will redirect to
    if (callbackOrigin !== currentOrigin) {
      return NextResponse.redirect(
        new URL(
          `/?tab=settings&xerror=${encodeURIComponent(
            `Open the app at ${callbackOrigin} (not ${currentOrigin}), then click Connect with X. Callback host must match.`,
          )}`,
          req.url,
        ),
      );
    }

    const { url, codeVerifier, state } = createOAuth2Link(redirectUri);

    const res = NextResponse.redirect(url);
    const cookieOpts = {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
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
