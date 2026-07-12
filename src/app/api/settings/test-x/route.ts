import { getSession } from "@/lib/auth";
import { jsonOk, unauthorized } from "@/lib/http";
import { verifyXWriteAuth } from "@/lib/x";

export async function POST() {
  if (!(await getSession())) return unauthorized();
  const result = await verifyXWriteAuth();
  return jsonOk(result, { status: result.ok ? 200 : 400 });
}
