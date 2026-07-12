import { NextRequest } from "next/server";
import { createSession, userExists, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!userExists()) {
    return jsonError("No account yet. Create one first.", 404);
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Email and password required");

  const user = getDb()
    .prepare("SELECT id, email, password_hash FROM users WHERE email = ?")
    .get(body.data.email.toLowerCase()) as
    | { id: number; email: string; password_hash: string }
    | undefined;

  if (!user || !(await verifyPassword(body.data.password, user.password_hash))) {
    return jsonError("Invalid email or password", 401);
  }

  await createSession({ id: user.id, email: user.email });
  return jsonOk({ ok: true });
}
