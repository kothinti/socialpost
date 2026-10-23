import { ACCOUNT_IDS, inAccount } from "@/lib/accounts";
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

  if (!["all", "fetch", "schedules", "mentions"].includes(job))
    return jsonError("Invalid job");
  const results: Record<string, unknown> = {};
  for (const account of ACCOUNT_IDS) {
    results[account] = await inAccount(account, async () => {
      try {
        if (job === "fetch") return await runDailyFetch();
        if (job === "schedules") return await processDueSchedules();
        if (job === "mentions") return await runMentionsFetch();
        return await runCronBundle();
      } catch (err) {
        return { error: err instanceof Error ? err.message : "Cron failed" };
      }
    });
  }
  return jsonOk(results);
}
