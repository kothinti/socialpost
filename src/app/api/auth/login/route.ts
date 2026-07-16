import { NextRequest } from "next/server";
import { createSession, hasUsers, verifyPassword } from "@/lib/auth";
import { findUserByEmail } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    if (!(await hasUsers())) {
      return jsonError("No account yet. Create the admin account first.", 404);
    }

    const body = schema.safeParse(await req.json());
    if (!body.success) return jsonError("Email and password required");

    const user = await findUserByEmail(body.data.email);
    if (
      !user ||
      !user.active ||
      !(await verifyPassword(body.data.password, user.passwordHash))
    ) {
      return jsonError("Invalid email or password", 401);
    }

    await createSession({
      id: user._id.toHexString(),
      email: user.email,
      role: user.role,
    });
    return jsonOk({ ok: true, role: user.role });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    return jsonError(message, 500);
  }
}
