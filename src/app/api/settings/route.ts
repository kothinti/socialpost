import { NextRequest } from "next/server";
import { getSession, requireAdmin } from "@/lib/auth";
import { getSettings, updateSettings } from "@/lib/db";
import { clampNonNegInt, normalizeKeywords } from "@/lib/feed-filters";
import { forbidden, jsonError, jsonOk, unauthorized } from "@/lib/http";
import { defaultRedirectUri } from "@/lib/x";
import { z } from "zod";

async function publicSettings(reqOrigin?: string) {
  const s = await getSettings();
  return {
    openai_model: s.openai_model,
    watched_handles: s.watched_handles,
    own_handle: s.own_handle,
    reply_system_prompt: s.reply_system_prompt,
    compose_system_prompt: s.compose_system_prompt,
    topic_keywords: s.topic_keywords,
    keyword_exact_match: s.keyword_exact_match,
    min_like_count: s.min_like_count,
    min_reply_count: s.min_reply_count,
    min_repost_count: s.min_repost_count,
    enable_topic_search: s.enable_topic_search,
    has_x_client_id: Boolean(s.x_api_key),
    has_x_client_secret: Boolean(s.x_api_secret),
    has_x_bearer_token: Boolean(s.x_bearer_token),
    has_x_user_token: Boolean(s.x_access_token),
    has_openai_api_key: Boolean(s.openai_api_key),
    x_connected_handle: s.x_connected_handle || "",
    x_redirect_uri: s.x_redirect_uri || (await defaultRedirectUri(reqOrigin)),
    read_only: false as boolean,
  };
}

async function postingView() {
  const s = await getSettings();
  return {
    openai_model: s.openai_model,
    watched_handles: s.watched_handles,
    own_handle: s.own_handle,
    reply_system_prompt: "",
    compose_system_prompt: "",
    topic_keywords: s.topic_keywords,
    keyword_exact_match: s.keyword_exact_match,
    min_like_count: s.min_like_count,
    min_reply_count: s.min_reply_count,
    min_repost_count: s.min_repost_count,
    enable_topic_search: s.enable_topic_search,
    has_x_client_id: Boolean(s.x_api_key),
    has_x_client_secret: Boolean(s.x_api_secret),
    has_x_bearer_token: Boolean(s.x_bearer_token),
    has_x_user_token: Boolean(s.x_access_token),
    has_openai_api_key: Boolean(s.openai_api_key),
    x_connected_handle: s.x_connected_handle || "",
    x_redirect_uri: "",
    read_only: true,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin) return jsonOk(await publicSettings(req.nextUrl.origin));

  const session = await getSession();
  if (!session) return unauthorized();
  return jsonOk(await postingView());
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
  topic_keywords: z.array(z.string()).optional(),
  keyword_exact_match: z.boolean().optional(),
  min_like_count: z.number().int().min(0).optional(),
  min_reply_count: z.number().int().min(0).optional(),
  min_repost_count: z.number().int().min(0).optional(),
  enable_topic_search: z.boolean().optional(),
});

export async function PUT(req: NextRequest) {
  const session = await requireAdmin();
  if (!session) return forbidden();

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid settings payload");

  const current = await getSettings();
  const data = body.data;

  await updateSettings({
    x_api_key: (data.x_client_id ?? current.x_api_key).trim(),
    x_api_secret: (data.x_client_secret ?? current.x_api_secret).trim(),
    x_bearer_token: (data.x_bearer_token ?? current.x_bearer_token).trim(),
    x_redirect_uri: (data.x_redirect_uri ?? current.x_redirect_uri ?? "").trim(),
    openai_api_key: (data.openai_api_key ?? current.openai_api_key).trim(),
    openai_model: data.openai_model ?? current.openai_model,
    watched_handles: (data.watched_handles ?? current.watched_handles)
      .map((h) => h.replace(/^@/, "").trim())
      .filter(Boolean),
    own_handle: (data.own_handle ?? current.own_handle).replace(/^@/, "").trim(),
    reply_system_prompt: data.reply_system_prompt ?? current.reply_system_prompt,
    compose_system_prompt:
      data.compose_system_prompt ?? current.compose_system_prompt,
    topic_keywords: normalizeKeywords(
      data.topic_keywords ?? current.topic_keywords,
    ),
    keyword_exact_match:
      data.keyword_exact_match ?? current.keyword_exact_match,
    min_like_count: clampNonNegInt(
      data.min_like_count ?? current.min_like_count,
      0,
    ),
    min_reply_count: clampNonNegInt(
      data.min_reply_count ?? current.min_reply_count,
      0,
    ),
    min_repost_count: clampNonNegInt(
      data.min_repost_count ?? current.min_repost_count,
      0,
    ),
    enable_topic_search:
      data.enable_topic_search ?? current.enable_topic_search,
  });

  return jsonOk(await publicSettings(req.nextUrl.origin));
}
