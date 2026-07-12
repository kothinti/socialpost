import { requireAdmin } from "@/lib/auth";
import { forbidden, jsonOk } from "@/lib/http";
import { verifyXWriteAuth } from "@/lib/x";

export async function POST() {
  if (!(await requireAdmin())) return forbidden();
  const result = await verifyXWriteAuth();
  return jsonOk(result, { status: result.ok ? 200 : 400 });
}
