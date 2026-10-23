import { accountId } from "@/lib/accounts";
import { accountRoute } from "@/lib/accounts";
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { completeOAuth2Login, formatXError } from "@/lib/x";
import { publicUrl } from "@/lib/origin";

async function handleGET(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.redirect(publicUrl(req, "/login"));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const errorDescription = req.nextUrl.searchParams.get("error_description");

  if (error) {
    const msg = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(
      publicUrl(req, `/?account=${accountId()}&tab=settings&xerror=${msg}`),
    );
  }

  const savedState = req.cookies.get("x_oauth_state")?.value;
  const codeVerifier = req.cookies.get("x_oauth_verifier")?.value;
  const redirectUri = req.cookies.get("x_oauth_redirect")?.value;

  if (!code || !codeVerifier || !redirectUri) {
    return NextResponse.redirect(
      publicUrl(
        req,
        "/?tab=settings&xerror=Missing%20OAuth%20session.%20Try%20Connect%20again.",
      ),
    );
  }

  if (!state || !savedState || state !== savedState) {
    return NextResponse.redirect(
      publicUrl(
        req,
        "/?tab=settings&xerror=OAuth%20state%20mismatch.%20Try%20Connect%20again.",
      ),
    );
  }

  try {
    const result = await completeOAuth2Login({
      code,
      codeVerifier,
      redirectUri,
    });
    const handle = result.handle ? encodeURIComponent(result.handle) : "";
    const res = NextResponse.redirect(
      publicUrl(
        req,
        `/?account=${accountId()}&tab=settings&xconnected=${handle || "1"}`,
      ),
    );
    res.cookies.delete("x_oauth_verifier");
    res.cookies.delete("x_oauth_state");
    res.cookies.delete("x_oauth_redirect");
    res.cookies.delete("x_oauth_account");
    return res;
  } catch (err) {
    const msg = encodeURIComponent(formatXError(err));
    return NextResponse.redirect(
      publicUrl(req, `/?account=${accountId()}&tab=settings&xerror=${msg}`),
    );
  }
}

export const GET = accountRoute(handleGET);
