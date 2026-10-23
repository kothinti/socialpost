import { accountRoute } from "@/lib/accounts";
import { getSession } from "@/lib/auth";
import { listMentions } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/http";

async function handleGET() {
  if (!(await getSession())) return unauthorized();

  const mentions = await listMentions();
  return jsonOk({ mentions });
}

export const GET = accountRoute(handleGET);
