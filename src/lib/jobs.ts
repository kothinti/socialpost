import { createHash } from "node:crypto";
import { claimPublication, releasePublication } from "./db";
import { getSettings } from "./db";
import { validateXText } from "./x-text";
import { UncertainPublishError } from "./x";
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

  let publishedId: string | null = null;
  let claimedKey: string | null = null;
  try {
    if ((await getSettings()).publishing_paused)
      throw new Error("Publishing is paused for this account");
    const validation = validateXText(content);
    if (validation) throw new Error(validation);
    if (
      draft.type === "reply" &&
      !(await canReplyViaApi(draft.reply_to_x_id))
    ) {
      throw new Error(REPLY_NOT_ALLOWED);
    }

    const key =
      draft.type === "reply"
        ? `reply:${draft.reply_to_x_id}`
        : createHash("sha256")
            .update(
              JSON.stringify([
                draft.type,
                content.normalize("NFC").trim(),
                draft.reply_to_x_id,
                mediaPaths,
              ]),
            )
            .digest("hex");
    if (!(await claimPublication(key, draft.id)))
      throw new Error(
        "Duplicate post or reply blocked. Check the queue and X before retrying.",
      );
    claimedKey = key;
    const xPostId = await publishPost({
      text: content,
      replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
      quoteTweetId: draft.type === "quote" ? draft.reply_to_x_id : null,
      mediaPaths,
    });

    publishedId = xPostId;

    const updated = await updateDraft(draft.id, {
      content,
      media_paths: mediaPaths,
      status: "posted",
      posted_at: new Date().toISOString(),
      x_post_id: xPostId,
      error: null,
      scheduled_at: null,
    });
    if (!updated) throw new Error("Published but could not record draft");
    if (draft.type === "reply" && draft.reply_to_x_id)
      await markMentionReplied(draft.reply_to_x_id, xPostId);
    return { ok: true, draft: updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (claimedKey && !publishedId && !(err instanceof UncertainPublishError))
      await releasePublication(claimedKey, draft.id);
    await updateDraft(draft.id, {
      status: publishedId
        ? "posted"
        : err instanceof UncertainPublishError
          ? "uncertain"
          : "failed",
      ...(publishedId
        ? { x_post_id: publishedId, posted_at: new Date().toISOString() }
        : {}),
      error: message,
    });
    return { ok: false, error: message };
  }
}

export async function runDailyFetch() {
  if ((await getSettings()).automation_paused)
    return { skipped: "automation paused" };
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
  if ((await getSettings()).automation_paused)
    return { skipped: "automation paused" };
  try {
    const result = await fetchMentions();
    await logJob(
      "mentions_fetch",
      "ok",
      result.skipped
        ? `skipped=${result.skipped}`
        : `fetched=${result.fetched}`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logJob("mentions_fetch", "error", message);
    throw err;
  }
}

export async function processDueSchedules() {
  const settings = await getSettings();
  if (settings.publishing_paused || settings.automation_paused) return [];
  const dueDrafts = await listDueDrafts();
  const results: {
    id: string;
    ok: boolean;
    error?: string;
    xPostId?: string;
  }[] = [];

  for (const due of dueDrafts) {
    const draft = await claimDraftForPosting(due.id, ["scheduled"], {
      dueBy: new Date(),
    });
    // Another cron run or a manual "Post now" got there first.
    if (!draft) continue;

    const result = await publishDraft(draft);
    results.push(
      result.ok
        ? {
            id: draft.id,
            ok: true,
            xPostId: result.draft.x_post_id ?? undefined,
          }
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
