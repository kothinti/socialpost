import { NextRequest } from "next/server";
import path from "path";
import { getSession } from "@/lib/auth";
import {
  createDraft,
  deleteDraft,
  findDraftById,
  listDrafts,
  updateDraft,
  type Draft,
} from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { toIsoUtc } from "@/lib/time";
import { publishPost } from "@/lib/x";
import { z } from "zod";

function serialize(d: Draft) {
  return d;
}

export async function GET() {
  if (!(await getSession())) return unauthorized();
  const drafts = await listDrafts();
  return jsonOk({ drafts: drafts.map(serialize) });
}

const createSchema = z.object({
  type: z.enum(["reply", "original"]),
  content: z.string().default(""),
  reply_to_x_id: z.string().optional(),
  reply_to_handle: z.string().optional(),
  reply_to_content: z.string().optional(),
  media_paths: z.array(z.string()).optional(),
  status: z.enum(["draft", "scheduled"]).optional(),
  scheduled_at: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return unauthorized();

  const body = createSchema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid draft");

  if (body.data.type === "reply" && !body.data.reply_to_x_id) {
    return jsonError("reply_to_x_id required for replies");
  }

  const status = body.data.status ?? "draft";
  if (status === "scheduled" && !body.data.scheduled_at) {
    return jsonError("scheduled_at required when scheduling");
  }

  const scheduledAt = body.data.scheduled_at
    ? toIsoUtc(body.data.scheduled_at)
    : null;

  const draft = await createDraft({
    type: body.data.type,
    content: body.data.content,
    reply_to_x_id: body.data.reply_to_x_id ?? null,
    reply_to_handle: body.data.reply_to_handle ?? null,
    reply_to_content: body.data.reply_to_content ?? null,
    media_paths: body.data.media_paths ?? [],
    status,
    scheduled_at: scheduledAt,
    created_by_user_id: session.id,
  });

  return jsonOk({ draft: serialize(draft) });
}

const actionSchema = z.object({
  id: z.string(),
  action: z.enum(["update", "schedule", "post", "delete"]),
  content: z.string().optional(),
  media_paths: z.array(z.string()).optional(),
  scheduled_at: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const body = actionSchema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid request");

  const draft = await findDraftById(body.data.id);
  if (!draft) return jsonError("Draft not found", 404);

  if (body.data.action === "delete") {
    await deleteDraft(body.data.id);
    return jsonOk({ ok: true });
  }

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
      body.data.action === "schedule" || scheduledAt ? "scheduled" : "draft";

    const updated = await updateDraft(draft.id, {
      content,
      media_paths: media,
      status: nextStatus,
      scheduled_at: scheduledAt,
      error: null,
    });

    return jsonOk({ draft: serialize(updated!) });
  }

  try {
    const mediaPaths = (body.data.media_paths ?? draft.media_paths).map((p) =>
      path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ process.cwd(), p),
    );
    const content = body.data.content ?? draft.content;
    const xPostId = await publishPost({
      text: content,
      replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
      mediaPaths,
    });

    const updated = await updateDraft(draft.id, {
      content,
      media_paths: body.data.media_paths ?? draft.media_paths,
      status: "posted",
      posted_at: new Date().toISOString(),
      x_post_id: xPostId,
      error: null,
      scheduled_at: null,
    });

    return jsonOk({ draft: serialize(updated!) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDraft(draft.id, { status: "failed", error: message });
    return jsonError(message, 500);
  }
}
