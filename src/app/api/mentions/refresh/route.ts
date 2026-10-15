import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { runMentionsFetch } from "@/lib/jobs";

export async function POST() {
  if (!(await getSession())) return unauthorized();

  try {
    return jsonOk(await runMentionsFetch());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Fetch failed", 500);
  }
}
