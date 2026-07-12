import path from "path";
import { getDb, parseJsonArray, type Draft } from "./db";
import { fetchWatchedPostsLast24h, publishPost } from "./x";

function logJob(job: string, status: string, detail?: string) {
  getDb()
    .prepare("INSERT INTO job_runs (job, status, detail) VALUES (?, ?, ?)")
    .run(job, status, detail ?? null);
}

export async function runDailyFetch() {
  try {
    const result = await fetchWatchedPostsLast24h();
    logJob(
      "daily_fetch",
      "ok",
      `handles=${result.handles.join(",")} scanned=${result.scanned} upserted=${result.inserted}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logJob("daily_fetch", "error", message);
    throw err;
  }
}

export async function processDueSchedules() {
  const db = getDb();
  const due = db
    .prepare(
      `SELECT * FROM drafts
       WHERE status = 'scheduled'
         AND scheduled_at IS NOT NULL
         AND scheduled_at <= datetime('now')
       ORDER BY scheduled_at ASC`,
    )
    .all() as Draft[];

  const results: { id: number; ok: boolean; error?: string; xPostId?: string }[] = [];

  for (const draft of due) {
    try {
      const mediaPaths = parseJsonArray(draft.media_paths);
      const xPostId = await publishPost({
        text: draft.content,
        replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
        mediaPaths: mediaPaths.map((p) =>
          path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ process.cwd(), p),
        ),
      });

      db.prepare(
        `UPDATE drafts SET status = 'posted', posted_at = datetime('now'),
         x_post_id = ?, error = NULL, updated_at = datetime('now') WHERE id = ?`,
      ).run(xPostId, draft.id);

      results.push({ id: draft.id, ok: true, xPostId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.prepare(
        `UPDATE drafts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(message, draft.id);
      results.push({ id: draft.id, ok: false, error: message });
    }
  }

  logJob(
    "process_schedules",
    results.every((r) => r.ok) || results.length === 0 ? "ok" : "partial",
    JSON.stringify(results),
  );

  return results;
}

export async function runCronBundle() {
  const fetch = await runDailyFetch().catch((err) => ({
    error: err instanceof Error ? err.message : String(err),
  }));
  const schedules = await processDueSchedules();
  return { fetch, schedules };
}
