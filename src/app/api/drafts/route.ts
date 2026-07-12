import { NextRequest } from "next/server";
import path from "path";
import { getSession } from "@/lib/auth";
import { getDb, parseJsonArray, type Draft } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { toSqliteUtc } from "@/lib/time";
import { publishPost } from "@/lib/x";
import { z } from "zod";

function serialize(d: Draft) {
  return {
    ...d,
    media_paths: parseJsonArray(d.media_paths),
  };
}

export async function GET() {
  if (!(await getSession())) return unauthorized();
  const drafts = getDb()
    .prepare(
      `SELECT * FROM drafts
       ORDER BY
         CASE status
           WHEN 'scheduled' THEN 0
           WHEN 'draft' THEN 1
           WHEN 'failed' THEN 2
           ELSE 3
         END,
         COALESCE(scheduled_at, updated_at) DESC`,
    )
    .all() as Draft[];
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
  if (!(await getSession())) return unauthorized();

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
    ? toSqliteUtc(body.data.scheduled_at)
    : null;

  const info = getDb()
    .prepare(
      `INSERT INTO drafts (
        type, reply_to_x_id, reply_to_handle, reply_to_content,
        content, media_paths, status, scheduled_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      body.data.type,
      body.data.reply_to_x_id ?? null,
      body.data.reply_to_handle ?? null,
      body.data.reply_to_content ?? null,
      body.data.content,
      JSON.stringify(body.data.media_paths ?? []),
      status,
      scheduledAt,
    );

  const draft = getDb()
    .prepare("SELECT * FROM drafts WHERE id = ?")
    .get(info.lastInsertRowid) as Draft;

  return jsonOk({ draft: serialize(draft) });
}

const actionSchema = z.object({
  id: z.number(),
  action: z.enum(["update", "schedule", "post", "delete"]),
  content: z.string().optional(),
  media_paths: z.array(z.string()).optional(),
  scheduled_at: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const body = actionSchema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid request");

  const db = getDb();
  const draft = db
    .prepare("SELECT * FROM drafts WHERE id = ?")
    .get(body.data.id) as Draft | undefined;
  if (!draft) return jsonError("Draft not found", 404);

  if (body.data.action === "delete") {
    db.prepare("DELETE FROM drafts WHERE id = ?").run(body.data.id);
    return jsonOk({ ok: true });
  }

  if (body.data.action === "update" || body.data.action === "schedule") {
    const content = body.data.content ?? draft.content;
    const media = body.data.media_paths ?? parseJsonArray(draft.media_paths);
    let scheduledAt: string | null =
      body.data.scheduled_at === undefined
        ? draft.scheduled_at
        : body.data.scheduled_at
          ? toSqliteUtc(body.data.scheduled_at)
          : null;

    if (body.data.action === "schedule") {
      if (!body.data.scheduled_at) return jsonError("scheduled_at required");
      scheduledAt = toSqliteUtc(body.data.scheduled_at);
    }

    const nextStatus =
      body.data.action === "schedule" || scheduledAt ? "scheduled" : "draft";

    db.prepare(
      `UPDATE drafts SET content = ?, media_paths = ?,
       status = ?, scheduled_at = ?, error = NULL, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(content, JSON.stringify(media), nextStatus, scheduledAt, draft.id);

    const updated = db.prepare("SELECT * FROM drafts WHERE id = ?").get(draft.id) as Draft;
    return jsonOk({ draft: serialize(updated) });
  }

  try {
    const mediaPaths = (body.data.media_paths ?? parseJsonArray(draft.media_paths)).map(
      (p) => (path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ process.cwd(), p)),
    );
    const content = body.data.content ?? draft.content;
    const xPostId = await publishPost({
      text: content,
      replyToId: draft.type === "reply" ? draft.reply_to_x_id : null,
      mediaPaths,
    });

    db.prepare(
      `UPDATE drafts SET content = ?, media_paths = ?, status = 'posted',
       posted_at = datetime('now'), x_post_id = ?, error = NULL,
       scheduled_at = NULL, updated_at = datetime('now') WHERE id = ?`,
    ).run(
      content,
      JSON.stringify(body.data.media_paths ?? parseJsonArray(draft.media_paths)),
      xPostId,
      draft.id,
    );

    const updated = db.prepare("SELECT * FROM drafts WHERE id = ?").get(draft.id) as Draft;
    return jsonOk({ draft: serialize(updated) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.prepare(
      `UPDATE drafts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(message, draft.id);
    return jsonError(message, 500);
  }
}
