import { accountRoute } from "@/lib/accounts";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { runMentionsFetch } from "@/lib/jobs";

async function handlePOST() {
  if (!(await getSession())) return unauthorized();

  try {
    return jsonOk(await runMentionsFetch());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Fetch failed", 500);
  }
}

export const POST = accountRoute(handlePOST);
