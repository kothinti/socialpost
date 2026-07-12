import { NextRequest } from "next/server";
import { createSession, hashPassword, userExists } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  if (userExists()) {
    return jsonError("Account already set up. Sign in instead.", 409);
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Valid email and password (8+ chars) required");

  const passwordHash = await hashPassword(body.data.password);
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash) VALUES (1, ?, ?)")
    .run(body.data.email.toLowerCase(), passwordHash);

  await createSession({ id: 1, email: body.data.email.toLowerCase() });
  return jsonOk({ ok: true });
}
