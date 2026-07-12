import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { getDb } from "./db";

const COOKIE = "sp_session";
const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || "socialpost-dev-secret-change-me",
);

export type SessionUser = { id: number; email: string };

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
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
    const id = Number(payload.sub);
    const email = String(payload.email || "");
    if (!id || !email) return null;

    const row = getDb()
      .prepare("SELECT id, email FROM users WHERE id = ?")
      .get(id) as { id: number; email: string } | undefined;

    return row ?? null;
  } catch {
    return null;
  }
}

export function userExists() {
  const row = getDb().prepare("SELECT id FROM users WHERE id = 1").get();
  return Boolean(row);
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
