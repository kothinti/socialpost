import { ApiResponseError, TwitterApi, EUploadMimeType } from "twitter-api-v2";
import fs from "fs";
import path from "path";
import {
  getDb,
  getSettings,
  parseJsonArray,
  saveOAuthTokens,
  type FetchedPost,
} from "./db";

export const X_OAUTH_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "offline.access",
  "media.write",
] as const;

export function formatXError(err: unknown): string {
  if (err instanceof ApiResponseError) {
    const parts: string[] = [`X API ${err.code}`];
    if (err.data?.detail) parts.push(String(err.data.detail));
    if (err.data?.title) parts.push(String(err.data.title));
    const nested = err.data?.errors;
    if (Array.isArray(nested)) {
      for (const e of nested) {
        if (e && typeof e === "object" && "message" in e) {
          parts.push(String((e as { message: string }).message));
        }
      }
    }
    if (err.code === 401 || err.code === 403) {
      parts.push(
        "Use OAuth 2.0: save Client ID + Client Secret, then click Connect with X. App-only Bearer Token cannot post.",
      );
    }
    return parts.filter(Boolean).join(" — ");
  }
  return err instanceof Error ? err.message : String(err);
}

export function defaultRedirectUri(reqOrigin?: string) {
  const s = getSettings();
  if (s.x_redirect_uri?.trim()) return s.x_redirect_uri.trim();
  // X prefers 127.0.0.1 over localhost for local callbacks
  if (reqOrigin) {
    try {
      const u = new URL(reqOrigin);
      if (u.hostname === "localhost") u.hostname = "127.0.0.1";
      return `${u.origin}/api/auth/x/callback`;
    } catch {
      /* fall through */
    }
  }
  return "http://127.0.0.1:3000/api/auth/x/callback";
}

function getOAuth2AppClient() {
  const s = getSettings();
  if (!s.x_api_key || !s.x_api_secret) {
    throw new Error("X Client ID and Client Secret are required");
  }
  return new TwitterApi({
    clientId: s.x_api_key.trim(),
    clientSecret: s.x_api_secret.trim(),
  });
}

/** Read timelines with app Bearer when available. */
function getReadClient() {
  const s = getSettings();
  if (s.x_bearer_token) {
    return new TwitterApi(s.x_bearer_token.trim());
  }
  if (s.x_access_token) {
    return new TwitterApi(s.x_access_token.trim());
  }
  throw new Error(
    "Add an X Bearer Token (for reading) or Connect with X in Settings.",
  );
}

async function ensureFreshUserToken(): Promise<string> {
  const s = getSettings();
  if (!s.x_access_token) {
    throw new Error(
      "Not connected to X. Save Client ID + Client Secret, then click Connect with X.",
    );
  }

  const expiresAt = s.x_oauth_expires_at ? Date.parse(s.x_oauth_expires_at) : NaN;
  const expiringSoon =
    Number.isFinite(expiresAt) && expiresAt - Date.now() < 2 * 60 * 1000;

  if (!expiringSoon) {
    return s.x_access_token.trim();
  }

  if (!s.x_access_secret) {
    return s.x_access_token.trim();
  }

  const app = getOAuth2AppClient();
  const refreshed = await app.refreshOAuth2Token(s.x_access_secret.trim());
  saveOAuthTokens({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? s.x_access_secret,
    expiresIn: refreshed.expiresIn,
  });
  return refreshed.accessToken;
}

async function getWriteClient() {
  const token = await ensureFreshUserToken();
  return new TwitterApi(token);
}

export function createOAuth2Link(redirectUri: string) {
  const client = getOAuth2AppClient();
  return client.generateOAuth2AuthLink(redirectUri, {
    scope: [...X_OAUTH_SCOPES],
  });
}

export async function completeOAuth2Login(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const client = getOAuth2AppClient();
  const result = await client.loginWithOAuth2({
    code: opts.code,
    codeVerifier: opts.codeVerifier,
    redirectUri: opts.redirectUri,
  });

  let handle: string | undefined;
  try {
    const me = await result.client.v2.me({ "user.fields": ["username"] });
    handle = me.data?.username;
  } catch {
    /* optional */
  }

  saveOAuthTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    handle: handle ?? null,
  });

  if (handle) {
    getDb()
      .prepare(
        `UPDATE settings SET own_handle = CASE WHEN own_handle = '' OR own_handle IS NULL THEN ? ELSE own_handle END WHERE id = 1`,
      )
      .run(handle);
  }

  return { handle, accessToken: result.accessToken };
}

export async function verifyXWriteAuth(): Promise<{
  ok: boolean;
  user?: { id: string; username?: string; name?: string };
  message: string;
}> {
  try {
    const client = await getWriteClient();
    const me = await client.v2.me({ "user.fields": ["username", "name"] });
    if (!me.data?.id) {
      return { ok: false, message: "X returned no user for these credentials" };
    }
    if (me.data.username) {
      getDb()
        .prepare(`UPDATE settings SET x_connected_handle = ? WHERE id = 1`)
        .run(me.data.username);
    }
    return {
      ok: true,
      user: {
        id: me.data.id,
        username: me.data.username,
        name: me.data.name,
      },
      message: `Authenticated as @${me.data.username ?? me.data.id}`,
    };
  } catch (err) {
    return { ok: false, message: formatXError(err) };
  }
}

function hoursAgoISO(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function mimeForFile(filePath: string): {
  media_type: EUploadMimeType;
  media_category: "tweet_image" | "tweet_gif" | "tweet_video";
} {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return { media_type: EUploadMimeType.Png, media_category: "tweet_image" };
    case ".webp":
      return { media_type: EUploadMimeType.Webp, media_category: "tweet_image" };
    case ".gif":
      return { media_type: EUploadMimeType.Gif, media_category: "tweet_gif" };
    case ".mp4":
      return { media_type: EUploadMimeType.Mp4, media_category: "tweet_video" };
    case ".mov":
      return { media_type: EUploadMimeType.Mov, media_category: "tweet_video" };
    case ".jpg":
    case ".jpeg":
    default:
      return { media_type: EUploadMimeType.Jpeg, media_category: "tweet_image" };
  }
}

export async function fetchWatchedPostsLast24h(): Promise<{
  inserted: number;
  scanned: number;
  handles: string[];
}> {
  const settings = getSettings();
  const handles = parseJsonArray(settings.watched_handles)
    .map((h) => h.replace(/^@/, "").trim())
    .filter(Boolean);

  if (handles.length === 0) {
    return { inserted: 0, scanned: 0, handles: [] };
  }

  const client = getReadClient().readOnly;
  const since = hoursAgoISO(24);
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO fetched_posts (
      x_post_id, author_id, author_handle, author_name, content, media_urls,
      like_count, reply_count, repost_count, posted_at, fetched_at
    ) VALUES (
      @x_post_id, @author_id, @author_handle, @author_name, @content, @media_urls,
      @like_count, @reply_count, @repost_count, @posted_at, datetime('now')
    )
    ON CONFLICT(x_post_id) DO UPDATE SET
      content = excluded.content,
      media_urls = excluded.media_urls,
      like_count = excluded.like_count,
      reply_count = excluded.reply_count,
      repost_count = excluded.repost_count,
      fetched_at = datetime('now')
  `);

  let inserted = 0;
  let scanned = 0;

  try {
    for (const handle of handles) {
      const user = await client.v2.userByUsername(handle, {
        "user.fields": ["name", "username"],
      });
      if (!user.data) continue;

      const timeline = await client.v2.userTimeline(user.data.id, {
        max_results: 50,
        exclude: ["retweets", "replies"],
        start_time: since,
        "tweet.fields": [
          "created_at",
          "public_metrics",
          "attachments",
          "author_id",
        ],
        expansions: ["attachments.media_keys"],
        "media.fields": ["url", "preview_image_url", "type"],
      });

      const mediaByKey = new Map<string, string>();
      for (const m of timeline.includes?.media ?? []) {
        const url = m.url || m.preview_image_url;
        if (url && m.media_key) mediaByKey.set(m.media_key, url);
      }

      for (const tweet of timeline.tweets) {
        scanned += 1;
        const mediaKeys = tweet.attachments?.media_keys ?? [];
        const mediaUrls = mediaKeys
          .map((k) => mediaByKey.get(k))
          .filter((u): u is string => Boolean(u));

        const info = upsert.run({
          x_post_id: tweet.id,
          author_id: user.data.id,
          author_handle: user.data.username,
          author_name: user.data.name,
          content: tweet.text,
          media_urls: JSON.stringify(mediaUrls),
          like_count: tweet.public_metrics?.like_count ?? 0,
          reply_count: tweet.public_metrics?.reply_count ?? 0,
          repost_count: tweet.public_metrics?.retweet_count ?? 0,
          posted_at: tweet.created_at ?? null,
        });
        if (info.changes > 0) inserted += 1;
      }
    }
  } catch (err) {
    throw new Error(formatXError(err));
  }

  db.prepare(
    `DELETE FROM fetched_posts WHERE posted_at IS NOT NULL AND posted_at < datetime('now', '-48 hours')`,
  ).run();

  return { inserted, scanned, handles };
}

export async function uploadMediaFiles(absolutePaths: string[]): Promise<string[]> {
  if (absolutePaths.length === 0) return [];
  const client = await getWriteClient();
  const mediaIds: string[] = [];

  for (const filePath of absolutePaths) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Media file missing: ${filePath}`);
    }
    const buffer = fs.readFileSync(filePath);
    const { media_type, media_category } = mimeForFile(filePath);
    const mediaId = await client.v2.uploadMedia(buffer, {
      media_type,
      media_category,
    });
    mediaIds.push(mediaId);
  }

  return mediaIds;
}

export async function publishPost(opts: {
  text: string;
  replyToId?: string | null;
  mediaPaths?: string[];
}): Promise<string> {
  try {
    const client = await getWriteClient();
    const absolute = (opts.mediaPaths ?? []).map((p) =>
      path.isAbsolute(p) ? p : path.join(/*turbopackIgnore: true*/ process.cwd(), p),
    );
    const mediaIds = await uploadMediaFiles(absolute);

    if (mediaIds.length > 4) {
      throw new Error("X allows at most 4 media attachments");
    }

    type MediaTuple =
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string];

    const payload: {
      text: string;
      reply?: { in_reply_to_tweet_id: string };
      media?: { media_ids: MediaTuple };
    } = { text: opts.text };

    if (opts.replyToId) {
      payload.reply = { in_reply_to_tweet_id: opts.replyToId };
    }
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds as MediaTuple };
    }

    const result = await client.v2.tweet(payload);
    if (!result.data?.id) throw new Error("X API returned no post id");
    return result.data.id;
  } catch (err) {
    throw new Error(formatXError(err));
  }
}

export function listFeed(limit = 100): FetchedPost[] {
  return getDb()
    .prepare(
      `SELECT * FROM fetched_posts
       WHERE posted_at IS NULL OR posted_at >= datetime('now', '-24 hours')
       ORDER BY posted_at DESC LIMIT ?`,
    )
    .all(limit) as FetchedPost[];
}
