import { accountRoute } from "@/lib/accounts";
import { getSession } from "@/lib/auth";
import { jsonOk, unauthorized } from "@/lib/http";
import { listFeed } from "@/lib/x";

async function handleGET() {
  if (!(await getSession())) return unauthorized();

  const posts = await listFeed();
  return jsonOk({ posts });
}

export const GET = accountRoute(handleGET);
