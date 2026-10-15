import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import {
  processDueSchedules,
  runCronBundle,
  runDailyFetch,
  runMentionsFetch,
} from "@/lib/jobs";

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;
  return false;
}

/**
 * Vercel Cron sends GET with `Authorization: Bearer $CRON_SECRET`. GET accepts
 * only the bearer secret (not a session cookie) so a plain link can't trigger it.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return unauthorized();
  return runJob(req);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session && !authorized(req)) return unauthorized();
  return runJob(req);
}

async function runJob(req: NextRequest) {
  const url = new URL(req.url);
  const job = url.searchParams.get("job") || "all";

  try {
    if (job === "fetch") return jsonOk(await runDailyFetch());
    if (job === "schedules") return jsonOk(await processDueSchedules());
    if (job === "mentions") return jsonOk(await runMentionsFetch());
    return jsonOk(await runCronBundle());
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Cron failed", 500);
  }
}
