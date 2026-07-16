import { getMongo } from "@/lib/db";
import { jsonError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unauthenticated health check for Mongo connectivity (safe: no secrets). */
export async function GET() {
  try {
    const db = await getMongo();
    await db.command({ ping: 1 });
    return jsonOk({
      ok: true,
      mongo: true,
      db: db.databaseName,
      hasUri: Boolean(process.env.MONGODB_URI),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(message, 500);
  }
}
