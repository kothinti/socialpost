import {
  claimDraftForPosting,
  findMentionByXId,
  listDueDrafts,
  logJob,
  markMentionReplied,
  updateDraft,
  type Draft,
} from "./db";
import { fetchMentions, fetchWatchedPostsLast24h, publishPost } from "./x";

export const REPLY_NOT_ALLOWED =
  "X only allows API replies to posts that @mention your account. Use Open in X to reply to other posts.";

/** API replies are only allowed to posts that mention us (X API, Feb 2026). */
export async function canReplyViaApi(xPostId: string | null | undefined) {
  if (!xPostId) return false;
  return Boolean(await findMentionByXId(xPostId));
}

/**
 * Publish a draft that the caller has already claimed (status "posting") and
 * record the outcome. Shared by cron and "Post now" so both enforce the same rules.
 */
export async function publishDraft(
  draft: Draft,
  overrides: { content?: string; media_paths?: string[] } = {},
): Promise<{ ok: true; draft: Draft } | { ok: false; error: string }> {
  const content = overrides.content ?? draft.content;
  const mediaPaths = overrides.media_paths ?? draft.media_paths;

  try {
    if (draft.type === "reply" && !(await canReplyViaApi(draft.reply_to_x_id))) {
      throw new Error(REPLY_NOT_ALLOWED);
    }

    const xPostId = await publishPost({
      text: content,
      replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
      quoteTweetId: draft.type === "quote" ? draft.reply_to_x_id : null,
      mediaPaths,
    });

    if (draft.type === "reply" && draft.reply_to_x_id) {
      await markMentionReplied(draft.reply_to_x_id, xPostId);
    }

    const updated = await updateDraft(draft.id, {
      content,
      media_paths: mediaPaths,
      status: "posted",
      posted_at: new Date().toISOString(),
      x_post_id: xPostId,
      error: null,
      scheduled_at: null,
    });
    return { ok: true, draft: updated! };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDraft(draft.id, { status: "failed", error: message });
    return { ok: false, error: message };
  }
}

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

export async function runMentionsFetch() {
  try {
    const result = await fetchMentions();
    await logJob(
      "mentions_fetch",
      "ok",
      result.skipped ? `skipped=${result.skipped}` : `fetched=${result.fetched}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logJob("mentions_fetch", "error", message);
    throw err;
  }
}

export async function processDueSchedules() {
  const dueDrafts = await listDueDrafts();
  const results: { id: string; ok: boolean; error?: string; xPostId?: string }[] =
    [];

  for (const due of dueDrafts) {
    const draft = await claimDraftForPosting(due.id, ["scheduled"], {
      dueBy: new Date(),
    });
    // Another cron run or a manual "Post now" got there first.
    if (!draft) continue;

    const result = await publishDraft(draft);
    results.push(
      result.ok
        ? { id: draft.id, ok: true, xPostId: result.draft.x_post_id ?? undefined }
        : { id: draft.id, ok: false, error: result.error },
    );
  }

  await logJob(
    "process_schedules",
    results.every((r) => r.ok) || results.length === 0 ? "ok" : "partial",
    JSON.stringify(results),
  );

  return results;
}

export async function runCronBundle() {
  const toError = (err: unknown) => ({
    error: err instanceof Error ? err.message : String(err),
  });
  const fetch = await runDailyFetch().catch(toError);
  const mentions = await runMentionsFetch().catch(toError);
  const schedules = await processDueSchedules();
  return { fetch, mentions, schedules };
}
