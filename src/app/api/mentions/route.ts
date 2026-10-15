import { getSession } from "@/lib/auth";
import { listMentions } from "@/lib/db";
import { jsonOk, unauthorized } from "@/lib/http";

export async function GET() {
  if (!(await getSession())) return unauthorized();

  const mentions = await listMentions();
  return jsonOk({ mentions });
}
