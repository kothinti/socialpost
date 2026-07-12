import { getSession } from "@/lib/auth";
import { parseJsonArray } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/http";
import { listFeed } from "@/lib/x";

export async function GET() {
  if (!(await getSession())) return unauthorized();

  const posts = listFeed().map((p) => ({
    ...p,
    media_urls: parseJsonArray(p.media_urls),
  }));

  return jsonOk({ posts });
}
