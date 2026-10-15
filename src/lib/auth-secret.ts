const DEV_FALLBACK = "socialpost-dev-secret-change-me";

let cached: Uint8Array | null = null;

/**
 * Session signing key. Resolved lazily (not at import) so `next build` works
 * without secrets, but any production request fails closed if AUTH_SECRET is
 * missing instead of signing sessions with a public string.
 */
export function getAuthSecret(): Uint8Array {
  if (cached) return cached;
  const raw = process.env.AUTH_SECRET?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is not set. Add it to the environment and redeploy.");
    }
    cached = new TextEncoder().encode(DEV_FALLBACK);
    return cached;
  }
  cached = new TextEncoder().encode(raw);
  return cached;
}
