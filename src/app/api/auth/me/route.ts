import { getSession, hasUsers } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const exists = await hasUsers();
    const session = await getSession();
    return jsonOk({
      needsSetup: !exists,
      authenticated: Boolean(session),
      user: session,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth check failed";
    return jsonError(message, 500);
  }
}
