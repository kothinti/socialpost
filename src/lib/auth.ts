import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import {
  countUsers,
  findUserById,
  type UserRole,
} from "./db";

const COOKIE = "sp_session";
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "socialpost-dev-secret-change-me",
);

export type SessionUser = {
  id: string;
  email: string;
  role: UserRole;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET);

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, SECRET);
    const id = String(payload.sub || "");
    const email = String(payload.email || "");
    if (!id || !email) return null;

    const row = await findUserById(id);
    if (!row || !row.active) return null;

    return {
      id: row._id.toHexString(),
      email: row.email,
      role: row.role,
    };
  } catch {
    return null;
  }
}

export async function hasUsers() {
  return (await countUsers()) > 0;
}

/** @deprecated use hasUsers() */
export async function userExists() {
  return hasUsers();
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function requireAdmin() {
  const session = await getSession();
  if (!session) return null;
  if (session.role !== "admin") return null;
  return session;
}
