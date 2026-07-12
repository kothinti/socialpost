import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { getDb, getSettings, parseJsonArray } from "@/lib/db";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { defaultRedirectUri } from "@/lib/x";
import { z } from "zod";

function publicSettings(reqOrigin?: string) {
  const s = getSettings();
  return {
    openai_model: s.openai_model,
    watched_handles: parseJsonArray(s.watched_handles),
    own_handle: s.own_handle,
    reply_system_prompt: s.reply_system_prompt,
    compose_system_prompt: s.compose_system_prompt,
    has_x_client_id: Boolean(s.x_api_key),
    has_x_client_secret: Boolean(s.x_api_secret),
    has_x_bearer_token: Boolean(s.x_bearer_token),
    has_x_user_token: Boolean(s.x_access_token),
    has_openai_api_key: Boolean(s.openai_api_key),
    x_connected_handle: s.x_connected_handle || "",
    x_redirect_uri: s.x_redirect_uri || defaultRedirectUri(reqOrigin),
  };
}

export async function GET(req: NextRequest) {
  if (!(await getSession())) return unauthorized();
  return jsonOk(publicSettings(req.nextUrl.origin));
}

const schema = z.object({
  x_client_id: z.string().optional(),
  x_client_secret: z.string().optional(),
  x_bearer_token: z.string().optional(),
  x_redirect_uri: z.string().optional(),
  openai_api_key: z.string().optional(),
  openai_model: z.string().optional(),
  watched_handles: z.array(z.string()).optional(),
  own_handle: z.string().optional(),
  reply_system_prompt: z.string().optional(),
  compose_system_prompt: z.string().optional(),
});

export async function PUT(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid settings payload");

  const current = getSettings();
  const data = body.data;

  const next = {
    x_api_key: (data.x_client_id ?? current.x_api_key).trim(),
    x_api_secret: (data.x_client_secret ?? current.x_api_secret).trim(),
    x_access_token: current.x_access_token,
    x_access_secret: current.x_access_secret,
    x_bearer_token: (data.x_bearer_token ?? current.x_bearer_token).trim(),
    x_oauth_expires_at: current.x_oauth_expires_at ?? "",
    x_redirect_uri: (data.x_redirect_uri ?? current.x_redirect_uri ?? "").trim(),
    x_connected_handle: current.x_connected_handle ?? "",
    openai_api_key: (data.openai_api_key ?? current.openai_api_key).trim(),
    openai_model: data.openai_model ?? current.openai_model,
    watched_handles: JSON.stringify(
      (data.watched_handles ?? parseJsonArray(current.watched_handles))
        .map((h) => h.replace(/^@/, "").trim())
        .filter(Boolean),
    ),
    own_handle: (data.own_handle ?? current.own_handle).replace(/^@/, "").trim(),
    reply_system_prompt: data.reply_system_prompt ?? current.reply_system_prompt,
    compose_system_prompt:
      data.compose_system_prompt ?? current.compose_system_prompt,
  };

  getDb()
    .prepare(
      `UPDATE settings SET
        x_api_key = @x_api_key,
        x_api_secret = @x_api_secret,
        x_access_token = @x_access_token,
        x_access_secret = @x_access_secret,
        x_bearer_token = @x_bearer_token,
        x_oauth_expires_at = @x_oauth_expires_at,
        x_redirect_uri = @x_redirect_uri,
        x_connected_handle = @x_connected_handle,
        openai_api_key = @openai_api_key,
        openai_model = @openai_model,
        watched_handles = @watched_handles,
        own_handle = @own_handle,
        reply_system_prompt = @reply_system_prompt,
        compose_system_prompt = @compose_system_prompt,
        updated_at = datetime('now')
      WHERE id = 1`,
    )
    .run(next);

  return jsonOk(publicSettings(req.nextUrl.origin));
}
