import { accountRoute } from "@/lib/accounts";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { runDailyFetch } from "@/lib/jobs";

async function handlePOST() {
  if (!(await getSession())) return unauthorized();

  try {
    const result = await runDailyFetch();
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Fetch failed", 500);
  }
}

export const POST = accountRoute(handlePOST);
