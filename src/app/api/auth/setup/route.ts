import { NextRequest } from "next/server";
import { createSession, hashPassword, hasUsers } from "@/lib/auth";
import { createUser } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { z } from "zod";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export async function POST(req: NextRequest) {
  if (await hasUsers()) {
    return jsonError("Setup already complete. Ask an admin to create your account.", 409);
  }

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Valid email and password (8+ chars) required");

  const passwordHash = await hashPassword(body.data.password);
  const user = await createUser({
    email: body.data.email,
    passwordHash,
    role: "admin",
  });

  await createSession({
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
  });
  return jsonOk({ ok: true });
}
