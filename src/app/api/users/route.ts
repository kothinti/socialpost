import { NextRequest } from "next/server";
import { hashPassword, requireAdmin } from "@/lib/auth";
import {
  countActiveAdmins,
  createUser,
  findUserByEmail,
  findUserById,
  listUsers,
  publicUser,
  updateUser,
  type UserRole,
} from "@/lib/db";
import { forbidden, jsonError, jsonOk } from "@/lib/http";
import { z } from "zod";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return forbidden();

  const users = await listUsers();
  return jsonOk({ users: users.map(publicUser) });
}

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "posting"]).default("posting"),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();

  const body = createSchema.safeParse(await req.json());
  if (!body.success) {
    return jsonError("Valid email, password (8+ chars), and role required");
  }

  const existing = await findUserByEmail(body.data.email);
  if (existing) return jsonError("Email already in use", 409);

  const passwordHash = await hashPassword(body.data.password);
  const user = await createUser({
    email: body.data.email,
    passwordHash,
    role: body.data.role as UserRole,
  });

  return jsonOk({ user: publicUser(user) });
}

const patchSchema = z.object({
  id: z.string(),
  role: z.enum(["admin", "posting"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return forbidden();

  const body = patchSchema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid request");

  const target = await findUserById(body.data.id);
  if (!target) return jsonError("User not found", 404);

  const nextRole = body.data.role ?? target.role;
  const nextActive = body.data.active ?? target.active;

  if (target.role === "admin" && target.active) {
    const demoting = nextRole !== "admin" || nextActive === false;
    if (demoting) {
      const admins = await countActiveAdmins();
      if (admins <= 1) {
        return jsonError("Cannot deactivate or demote the last active admin");
      }
    }
  }

  const patch: {
    role?: UserRole;
    active?: boolean;
    passwordHash?: string;
  } = {};
  if (body.data.role !== undefined) patch.role = body.data.role;
  if (body.data.active !== undefined) patch.active = body.data.active;
  if (body.data.password) {
    patch.passwordHash = await hashPassword(body.data.password);
  }

  const updated = await updateUser(body.data.id, patch);
  if (!updated) return jsonError("Update failed", 500);

  return jsonOk({ user: publicUser(updated) });
}
