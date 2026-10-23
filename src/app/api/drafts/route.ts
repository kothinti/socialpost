import { validateXText } from "@/lib/x-text";
import { getSettings } from "@/lib/db";
import { accountRoute } from "@/lib/accounts";
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import {
  claimDraftForPosting,
  createDraft,
  deleteDraft,
  findDraftById,
  listDrafts,
  updateDraft,
  type Draft,
} from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { canReplyViaApi, publishDraft, REPLY_NOT_ALLOWED } from "@/lib/jobs";
import { toIsoUtc } from "@/lib/time";
import { z } from "zod";

function serialize(d: Draft) {
  return d;
}

async function handleGET() {
  if (!(await getSession())) return unauthorized();
  const drafts = await listDrafts();
  return jsonOk({ drafts: drafts.map(serialize) });
}

const createSchema = z.object({
  type: z.enum(["reply", "quote", "original"]),
  content: z.string().default(""),
  /** Post replied to or quoted. */
  reply_to_x_id: z.string().optional(),
  reply_to_handle: z.string().optional(),
  media_paths: z.array(z.string()).max(4).optional(),
  status: z.enum(["draft", "scheduled", "pending_approval"]).optional(),
  scheduled_at: z.string().nullable().optional(),
});

async function handlePOST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Invalid draft");

  if (body.data.type !== "original" && !body.data.reply_to_x_id) {
    return jsonError("reply_to_x_id required for replies and quotes");
  }
  if (
    body.data.type === "reply" &&
    !(await canReplyViaApi(body.data.reply_to_x_id))
  ) {
    return jsonError(REPLY_NOT_ALLOWED);
  }

  const validation = validateXText(body.data.content);
  if (validation) return jsonError(validation);
  const status =
    session.role !== "admin" && body.data.status === "scheduled"
      ? "pending_approval"
      : (body.data.status ?? "draft");
  if (status === "scheduled" && !body.data.scheduled_at) {
    return jsonError("scheduled_at required when scheduling");
  }

  if (
    body.data.scheduled_at &&
    (!Number.isFinite(Date.parse(body.data.scheduled_at)) ||
      Date.parse(body.data.scheduled_at) <= Date.now())
  )
    return jsonError("Pick a valid future schedule time");
  const scheduledAt = body.data.scheduled_at
    ? toIsoUtc(body.data.scheduled_at)
    : null;

  const draft = await createDraft({
    type: body.data.type,
    content: body.data.content,
    reply_to_x_id: body.data.reply_to_x_id ?? null,
    reply_to_handle: body.data.reply_to_handle ?? null,
    reply_to_content: null,
    media_paths: body.data.media_paths ?? [],
    status,
    scheduled_at: scheduledAt,
    created_by_user_id: session.id,
  });

  return jsonOk({ draft: serialize(draft) });
}

const actionSchema = z.object({
  id: z.string(),
  action: z.enum(["update", "schedule", "post", "delete", "submit", "approve"]),
  content: z.string().optional(),
  media_paths: z.array(z.string()).max(4).optional(),
  scheduled_at: z.string().nullable().optional(),
});

async function handlePATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = actionSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Invalid request");

  const draft = await findDraftById(body.data.id);
  if (!draft) return jsonError("Draft not found", 404);

  if (body.data.action === "delete") {
    if (!(await deleteDraft(body.data.id)))
      return jsonError("Cannot delete a posting or uncertain draft", 409);
    return jsonOk({ ok: true });
  }

  if (
    draft.status === "posting" ||
    draft.status === "posted" ||
    draft.status === "uncertain"
  ) {
    return jsonError(`Draft is already ${draft.status}`, 409);
  }

  const validation = validateXText(body.data.content ?? draft.content);
  if (validation) return jsonError(validation);
  if (
    body.data.scheduled_at &&
    (!Number.isFinite(Date.parse(body.data.scheduled_at)) ||
      Date.parse(body.data.scheduled_at) <= Date.now())
  )
    return jsonError("Pick a valid future schedule time");
  if (body.data.action === "submit" || body.data.action === "approve") {
    const approving = body.data.action === "approve";
    if (approving && session.role !== "admin")
      return jsonError("Admin approval required", 403);
    if (approving && draft.status !== "pending_approval")
      return jsonError("Draft is not awaiting approval", 409);
    if (
      approving &&
      draft.scheduled_at &&
      Date.parse(draft.scheduled_at) <= Date.now()
    )
      return jsonError("Schedule has passed; update it before approval");
    const updated = await updateDraft(
      draft.id,
      {
        status: approving
          ? draft.scheduled_at
            ? "scheduled"
            : "draft"
          : "pending_approval",
        error: null,
      },
      [draft.status],
      draft.updated_at,
    );
    if (!updated) return jsonError("Draft changed; refresh and retry", 409);
    return jsonOk({ draft: updated });
  }
  if (
    body.data.action === "post" &&
    (session.role !== "admin" || draft.status === "pending_approval")
  )
    return jsonError("Admin approval required before posting", 403);
  if (body.data.action === "post" && (await getSettings()).publishing_paused)
    return jsonError("Publishing is paused for this account", 409);

  if (body.data.action === "update" || body.data.action === "schedule") {
    const content = body.data.content ?? draft.content;
    const media = body.data.media_paths ?? draft.media_paths;
    let scheduledAt: string | null =
      body.data.scheduled_at === undefined
        ? draft.scheduled_at
        : body.data.scheduled_at
          ? toIsoUtc(body.data.scheduled_at)
          : null;

    if (body.data.action === "schedule") {
      if (!body.data.scheduled_at) return jsonError("scheduled_at required");
      scheduledAt = toIsoUtc(body.data.scheduled_at);
    }

    const nextStatus =
      draft.status === "pending_approval" ||
      (session.role !== "admin" &&
        (body.data.action === "schedule" || scheduledAt))
        ? "pending_approval"
        : body.data.action === "schedule" || scheduledAt
          ? "scheduled"
          : "draft";

    const updated = await updateDraft(
      draft.id,
      {
        content,
        media_paths: media,
        status: nextStatus,
        scheduled_at: scheduledAt,
        error: null,
      },
      [draft.status],
      draft.updated_at,
    );
    if (!updated) return jsonError("Draft is already being posted", 409);

    return jsonOk({ draft: serialize(updated) });
  }

  // Claim before publishing so a concurrent cron run (or double click) can't post it too.
  const claimed = await claimDraftForPosting(draft.id, [
    "draft",
    "scheduled",
    "failed",
  ]);
  if (!claimed) return jsonError("Draft is already being posted", 409);

  const result = await publishDraft(claimed, {
    content: body.data.content,
    media_paths: body.data.media_paths,
  });
  if (!result.ok) return jsonError(result.error, 500);
  return jsonOk({ draft: serialize(result.draft) });
}

export const GET = accountRoute(handleGET);
export const POST = accountRoute(handlePOST);
export const PATCH = accountRoute(handlePATCH);
