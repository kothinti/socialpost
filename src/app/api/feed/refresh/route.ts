import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { runDailyFetch } from "@/lib/jobs";

export async function POST() {
  if (!(await getSession())) return unauthorized();

  try {
    const result = await runDailyFetch();
    return jsonOk(result);
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Fetch failed", 500);
  }
}
