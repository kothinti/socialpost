import {
  listDueDrafts,
  logJob,
  updateDraft,
} from "./db";
import { fetchWatchedPostsLast24h, publishPost } from "./x";

export async function runDailyFetch() {
  try {
    const result = await fetchWatchedPostsLast24h();
    await logJob(
      "daily_fetch",
      "ok",
      `handles=${result.handles.join(",")} scanned=${result.scanned} skipped=${result.skipped} upserted=${result.inserted} topic_search=${result.topic_search}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logJob("daily_fetch", "error", message);
    throw err;
  }
}

export async function processDueSchedules() {
  const due = await listDueDrafts();
  const results: { id: string; ok: boolean; error?: string; xPostId?: string }[] =
    [];

  for (const draft of due) {
    try {
      const mediaPaths = draft.media_paths ?? [];
      const xPostId = await publishPost({
        text: draft.content,
        replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
        mediaPaths,
      });

      await updateDraft(draft.id, {
        status: "posted",
        posted_at: new Date().toISOString(),
        x_post_id: xPostId,
        error: null,
        scheduled_at: null,
      });

      results.push({ id: draft.id, ok: true, xPostId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateDraft(draft.id, {
        status: "failed",
        error: message,
      });
      results.push({ id: draft.id, ok: false, error: message });
    }
  }

  await logJob(
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
