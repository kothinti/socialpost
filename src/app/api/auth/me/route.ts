import { getSession, hasUsers } from "@/lib/auth";
import { jsonOk } from "@/lib/http";

export async function GET() {
  const exists = await hasUsers();
  const session = await getSession();
  return jsonOk({
    needsSetup: !exists,
    authenticated: Boolean(session),
    user: session,
  });
}
