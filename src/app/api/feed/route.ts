import { getSession } from "@/lib/auth";
import { jsonOk, unauthorized } from "@/lib/http";
import { listFeed } from "@/lib/x";

export async function GET() {
  if (!(await getSession())) return unauthorized();

  const posts = await listFeed();
  return jsonOk({ posts });
}
