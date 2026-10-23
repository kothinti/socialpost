import { accountId, inAccount } from "./accounts";
import { acquireAccountLease, releaseAccountLease } from "./db";
import { validateXText } from "./x-text";
import { ApiResponseError, TwitterApi, EUploadMimeType } from "twitter-api-v2";
import fs from "fs";
import path from "path";
import {
  deleteFetchedPostById,
  deleteOldFetchedPosts,
  deleteOldMentions,
  getSettings,
  getUploadsDir,
  listFetchedPostsSince,
  readMedia,
  saveOAuthTokens,
  updateSettings,
  upsertFetchedPost,
  upsertMention,
  type FetchedPost,
  type Settings,
} from "./db";
import { buildTopicSearchQuery, passesFeedFilters } from "./feed-filters";
import {
  feedFiltersFromSettings,
  getFeedFilterSettings,
} from "./feed-settings";

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
    if (err.code === 429)
      parts.push(
        "Rate limit reached. Wait for the X rate-limit reset before retrying.",
      );
    if (err.code === 402)
      parts.push(
        "Check X API credits and endpoint access in the developer console.",
      );
    if (err.code === 401 || err.code === 403) {
      parts.push(
        "Use OAuth 2.0: save Client ID + Client Secret, then click Connect with X. App-only Bearer Token cannot post.",
      );
    }
    return parts.filter(Boolean).join(" — ");
  }
  return err instanceof Error ? err.message : String(err);
}

export async function defaultRedirectUri(reqOrigin?: string) {
  // Prefer the live request origin so local + Vercel both work without stale settings.
  if (reqOrigin) {
    try {
      const u = new URL(reqOrigin);
      if (u.hostname === "localhost") u.hostname = "127.0.0.1";
      return `${u.origin}/api/auth/x/callback`;
    } catch {
      /* fall through */
    }
  }

  const s = await getSettings();
  if (s.x_redirect_uri?.trim()) return s.x_redirect_uri.trim();

  const appUrl = process.env.APP_URL?.trim() || process.env.VERCEL_URL?.trim();
  if (appUrl) {
    const base = appUrl.startsWith("http") ? appUrl : `https://${appUrl}`;
    try {
      return `${new URL(base).origin}/api/auth/x/callback`;
    } catch {
      /* fall through */
    }
  }

  return "http://127.0.0.1:3000/api/auth/x/callback";
}

async function getOAuth2AppClient() {
  const s = await getSettings();
  if (!s.x_api_key || !s.x_api_secret) {
    throw new Error("X Client ID and Client Secret are required");
  }
  return new TwitterApi({
    clientId: s.x_api_key.trim(),
    clientSecret: s.x_api_secret.trim(),
  });
}

async function getReadClient() {
  const s = await getSettings();
  if (s.x_bearer_token) {
    return new TwitterApi(s.x_bearer_token.trim());
  }
  if (s.x_access_token) {
    return new TwitterApi(await ensureFreshUserToken());
  }
  throw new Error(
    "Add an X Bearer Token (for reading) or Connect with X in Settings.",
  );
}

async function ensureFreshUserToken(): Promise<string> {
  const s = await getSettings();
  if (!s.x_access_token) {
    throw new Error(
      "Not connected to X. Save Client ID + Client Secret, then click Connect with X.",
    );
  }

  const expiresAt = s.x_oauth_expires_at
    ? Date.parse(s.x_oauth_expires_at)
    : NaN;
  const expiringSoon =
    Number.isFinite(expiresAt) && expiresAt - Date.now() < 2 * 60 * 1000;

  if (!expiringSoon) {
    return s.x_access_token.trim();
  }

  if (!s.x_access_secret) {
    return s.x_access_token.trim();
  }

  const lease = await acquireAccountLease("oauth-refresh", 30);
  if (!lease)
    throw new Error("X token refresh is in progress. Try again shortly.");
  try {
    const current = await getSettings();
    if (current.x_access_token !== s.x_access_token)
      return current.x_access_token;
    const app = await getOAuth2AppClient();
    const refreshed = await app.refreshOAuth2Token(
      current.x_access_secret.trim(),
    );
    await saveOAuthTokens({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? current.x_access_secret,
      expiresIn: refreshed.expiresIn,
    });
    return refreshed.accessToken;
  } finally {
    await releaseAccountLease("oauth-refresh", lease);
  }
}

async function getWriteClient() {
  const token = await ensureFreshUserToken();
  return new TwitterApi(token);
}

export async function createOAuth2Link(redirectUri: string) {
  const client = await getOAuth2AppClient();
  return client.generateOAuth2AuthLink(redirectUri, {
    scope: [...X_OAUTH_SCOPES],
  });
}

export async function completeOAuth2Login(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}) {
  const client = await getOAuth2AppClient();
  const result = await client.loginWithOAuth2({
    code: opts.code,
    codeVerifier: opts.codeVerifier,
    redirectUri: opts.redirectUri,
  });

  let handle: string | undefined;
  let userId: string | undefined;
  try {
    const me = await result.client.v2.me({ "user.fields": ["username"] });
    handle = me.data?.username;
    userId = me.data?.id;
  } catch {
    throw new Error(
      "Could not verify the X account identity. Please reconnect.",
    );
  }
  if (!userId || !handle) throw new Error("X returned no account identity");
  const other = await inAccount(
    accountId() === "personal" ? "company" : "personal",
    () => getSettings(),
  );
  if (other.x_connected_user_id === userId)
    throw new Error(
      "This X account is already connected to the other profile. Choose a different X account.",
    );
  const current = await getSettings();
  if (current.x_connected_user_id && current.x_connected_user_id !== userId)
    throw new Error(
      "This profile is already bound to another X account. Reconnect the same account to preserve its queue.",
    );

  await saveOAuthTokens({
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    handle: handle ?? null,
    userId: userId ?? null,
  });

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
    const s = await getSettings();
    if (s.x_connected_user_id && s.x_connected_user_id !== me.data.id)
      throw new Error(
        "X identity differs from this profile. Reconnect its original account before posting.",
      );
    await updateSettings({
      x_connected_handle: me.data.username || s.x_connected_handle,
      x_connected_user_id: me.data.id,
      ...(s.x_connected_user_id !== me.data.id
        ? {
            mentions_since_id: "",
            mentions_next_token: "",
            mentions_pending_newest_id: "",
          }
        : {}),
    });
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
      return {
        media_type: EUploadMimeType.Webp,
        media_category: "tweet_image",
      };
    case ".gif":
      return { media_type: EUploadMimeType.Gif, media_category: "tweet_gif" };
    case ".mp4":
      return { media_type: EUploadMimeType.Mp4, media_category: "tweet_video" };
    case ".mov":
      return { media_type: EUploadMimeType.Mov, media_category: "tweet_video" };
    case ".jpg":
    case ".jpeg":
    default:
      return {
        media_type: EUploadMimeType.Jpeg,
        media_category: "tweet_image",
      };
  }
}

type UpsertPostRow = {
  x_post_id: string;
  author_id: string | null;
  author_handle: string;
  author_name: string | null;
  content: string;
  media_urls: string[];
  like_count: number;
  reply_count: number;
  repost_count: number;
  posted_at: string | null;
};

async function fetchWatchedPostsLast24hUnlocked(): Promise<{
  inserted: number;
  scanned: number;
  skipped: number;
  handles: string[];
  topic_search: boolean;
  search_query: string | null;
}> {
  const settings = await getSettings();
  const filters = feedFiltersFromSettings(settings);
  const handles = (settings.watched_handles ?? [])
    .map((h) => h.replace(/^@/, "").trim())
    .filter(Boolean);

  const searchQuery =
    filters.enable_topic_search && filters.topic_keywords.length > 0
      ? buildTopicSearchQuery(filters)
      : null;

  if (handles.length === 0 && !searchQuery) {
    return {
      inserted: 0,
      scanned: 0,
      skipped: 0,
      handles: [],
      topic_search: false,
      search_query: null,
    };
  }

  const client = (await getReadClient()).readOnly;
  const since = hoursAgoISO(24);

  let inserted = 0;
  let scanned = 0;
  let skipped = 0;

  const tryUpsert = async (row: UpsertPostRow) => {
    scanned += 1;
    if (!passesFeedFilters(row, filters)) {
      skipped += 1;
      return;
    }
    const changed = await upsertFetchedPost(row);
    if (changed) inserted += 1;
  };

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
        const mediaKeys = tweet.attachments?.media_keys ?? [];
        const mediaUrls = mediaKeys
          .map((k) => mediaByKey.get(k))
          .filter((u): u is string => Boolean(u));

        await tryUpsert({
          x_post_id: tweet.id,
          author_id: user.data.id,
          author_handle: user.data.username,
          author_name: user.data.name,
          content: tweet.text,
          media_urls: mediaUrls,
          like_count: tweet.public_metrics?.like_count ?? 0,
          reply_count: tweet.public_metrics?.reply_count ?? 0,
          repost_count: tweet.public_metrics?.retweet_count ?? 0,
          posted_at: tweet.created_at ?? null,
        });
      }
    }

    if (searchQuery) {
      const search = await client.v2.search(searchQuery, {
        max_results: 50,
        start_time: since,
        "tweet.fields": [
          "created_at",
          "public_metrics",
          "attachments",
          "author_id",
        ],
        expansions: ["author_id", "attachments.media_keys"],
        "user.fields": ["username", "name"],
        "media.fields": ["url", "preview_image_url", "type"],
      });

      const mediaByKey = new Map<string, string>();
      for (const m of search.includes?.media ?? []) {
        const url = m.url || m.preview_image_url;
        if (url && m.media_key) mediaByKey.set(m.media_key, url);
      }

      const usersById = new Map<string, { username: string; name?: string }>();
      for (const u of search.includes?.users ?? []) {
        if (u.id && u.username) {
          usersById.set(u.id, { username: u.username, name: u.name });
        }
      }

      for (const tweet of search.tweets) {
        const author = tweet.author_id
          ? usersById.get(tweet.author_id)
          : undefined;
        const mediaKeys = tweet.attachments?.media_keys ?? [];
        const mediaUrls = mediaKeys
          .map((k) => mediaByKey.get(k))
          .filter((u): u is string => Boolean(u));

        await tryUpsert({
          x_post_id: tweet.id,
          author_id: tweet.author_id ?? null,
          author_handle: author?.username ?? "unknown",
          author_name: author?.name ?? null,
          content: tweet.text,
          media_urls: mediaUrls,
          like_count: tweet.public_metrics?.like_count ?? 0,
          reply_count: tweet.public_metrics?.reply_count ?? 0,
          repost_count: tweet.public_metrics?.retweet_count ?? 0,
          posted_at: tweet.created_at ?? null,
        });
      }
    }
  } catch (err) {
    throw new Error(formatXError(err));
  }

  // Keep stored X content short-lived (Developer Policy: stored content must stay current).
  await deleteOldFetchedPosts(24);

  const stale = await listFetchedPostsSince(24, 500);
  for (const row of stale) {
    if (!passesFeedFilters(row, filters)) {
      await deleteFetchedPostById(row.id);
    }
  }

  return {
    inserted,
    scanned,
    skipped,
    handles,
    topic_search: Boolean(searchQuery),
    search_query: searchQuery,
  };
}

async function getConnectedUserId(): Promise<string> {
  const s = await getSettings();
  if (s.x_connected_user_id) return s.x_connected_user_id;
  const client = await getWriteClient();
  const me = await client.v2.me();
  if (!me.data?.id)
    throw new Error("X returned no user for the connected account");
  await updateSettings({ x_connected_user_id: me.data.id });
  return me.data.id;
}

/**
 * Pull new posts that @mention the connected account. These are the only posts
 * this app permits for API replies. Uses the account's user token. Owned-read
 * pricing only applies if that user owns the developer app. Pagination and
 * since_id keep each run bounded without skipping a backlog.
 */
async function fetchMentionsUnlocked(): Promise<{
  fetched: number;
  skipped?: string;
}> {
  const settings = await getSettings();
  if (!settings.enable_mentions) return { fetched: 0, skipped: "disabled" };
  if (!settings.x_access_token) return { fetched: 0, skipped: "not connected" };

  try {
    const userId = await getConnectedUserId();
    const client = await getWriteClient();
    const maxResults = Math.min(
      100,
      Math.max(5, settings.mentions_max_results),
    );

    const page = await client.v2.userMentionTimeline(userId, {
      max_results: maxResults,
      ...(settings.mentions_since_id
        ? { since_id: settings.mentions_since_id }
        : {}),
      ...(settings.mentions_next_token
        ? { pagination_token: settings.mentions_next_token }
        : {}),
      "tweet.fields": ["created_at", "author_id"],
      expansions: ["author_id"],
      "user.fields": ["username", "name"],
    });

    const usersById = new Map<string, { username: string; name?: string }>();
    for (const u of page.includes?.users ?? []) {
      usersById.set(u.id, { username: u.username, name: u.name });
    }

    for (const tweet of page.tweets) {
      const author = tweet.author_id
        ? usersById.get(tweet.author_id)
        : undefined;
      await upsertMention({
        x_post_id: tweet.id,
        author_handle: author?.username ?? "unknown",
        author_name: author?.name ?? null,
        content: tweet.text,
        posted_at: tweet.created_at ?? null,
      });
    }

    const newest =
      settings.mentions_pending_newest_id ||
      page.meta?.newest_id ||
      settings.mentions_since_id;
    if (page.meta?.next_token) {
      await updateSettings({
        mentions_next_token: page.meta.next_token,
        mentions_pending_newest_id: newest,
      });
    } else {
      await updateSettings({
        mentions_since_id: newest,
        mentions_next_token: "",
        mentions_pending_newest_id: "",
      });
    }
    await deleteOldMentions(1);

    return { fetched: page.tweets.length };
  } catch (err) {
    if (
      settings.mentions_next_token &&
      err instanceof ApiResponseError &&
      err.code === 400
    ) {
      await updateSettings({
        mentions_next_token: "",
        mentions_pending_newest_id: "",
      });
    }
    throw new Error(formatXError(err));
  }
}

/**
 * Media paths come from the client, so only ever use the basename. New uploads
 * live in GridFS; older drafts may reference files in the local uploads dir
 * (stored as a bare name, data/uploads/..., or an absolute path).
 */
async function loadMedia(p: string): Promise<Buffer> {
  const base = path.basename(p);
  if (!base || base === "." || base === "..") {
    throw new Error(`Invalid media path: ${p}`);
  }
  const stored = await readMedia(base);
  if (stored) return stored;
  const legacy = path.join(getUploadsDir(), base);
  if (accountId() === "company" && fs.existsSync(legacy))
    return fs.readFileSync(legacy);
  throw new Error(`Media file missing: ${base}`);
}

export async function uploadMediaFiles(
  mediaPaths: string[],
): Promise<string[]> {
  if (mediaPaths.length === 0) return [];
  const client = await getWriteClient();
  const mediaIds: string[] = [];

  for (const p of mediaPaths) {
    const buffer = await loadMedia(p);
    const { media_type, media_category } = mimeForFile(p);
    const mediaId = await client.v2.uploadMedia(buffer, {
      media_type,
      media_category,
    });
    mediaIds.push(mediaId);
  }

  return mediaIds;
}

export class UncertainPublishError extends Error {}

export async function publishPost(opts: {
  text: string;
  replyToId?: string | null;
  quoteTweetId?: string | null;
  mediaPaths?: string[];
}): Promise<string> {
  let sending = false;
  try {
    const validation = validateXText(opts.text);
    if (validation) throw new Error(validation);
    const mediaPaths = opts.mediaPaths ?? [];
    const videos = mediaPaths.filter((p) => /\.(mp4|mov|gif)$/i.test(p));
    if (videos.length && mediaPaths.length > 1)
      throw new Error("Use one video/GIF or up to four still images");
    if (mediaPaths.length > 4) {
      throw new Error("X allows at most 4 media attachments");
    }

    const client = await getWriteClient();
    const mediaIds = await uploadMediaFiles(mediaPaths);

    type MediaTuple =
      | [string]
      | [string, string]
      | [string, string, string]
      | [string, string, string, string];

    const payload: {
      text: string;
      reply?: { in_reply_to_tweet_id: string };
      quote_tweet_id?: string;
      media?: { media_ids: MediaTuple };
    } = { text: opts.text };

    if (opts.replyToId) {
      payload.reply = { in_reply_to_tweet_id: opts.replyToId };
    }
    if (opts.quoteTweetId) {
      payload.quote_tweet_id = opts.quoteTweetId;
    }
    if (mediaIds.length > 0) {
      payload.media = { media_ids: mediaIds as MediaTuple };
    }

    sending = true;
    const result = await client.v2.tweet(payload);
    if (!result.data?.id) throw new Error("X API returned no post id");
    return result.data.id;
  } catch (err) {
    if (sending && (!(err instanceof ApiResponseError) || err.code >= 500)) {
      throw new UncertainPublishError(
        "X delivery is uncertain. Check the account on X before creating another post. " +
          formatXError(err),
      );
    }
    if (opts.replyToId && err instanceof ApiResponseError && err.code === 403) {
      throw new Error(
        "X refused this reply. The API only allows replies to posts that @mention your account or quote your post. Use Open in X to reply manually.",
      );
    }
    throw new Error(formatXError(err));
  }
}

export async function listFeed(limit = 100): Promise<FetchedPost[]> {
  const filters = await getFeedFilterSettings();
  const rows = await listFetchedPostsSince(24, Math.max(limit * 3, 100));
  return rows.filter((row) => passesFeedFilters(row, filters)).slice(0, limit);
}

export type { Settings };

export async function fetchWatchedPostsLast24h() {
  const lease = await acquireAccountLease("fetchWatchedPostsLast24h", 300);
  if (!lease) throw new Error("A refresh for this account is already running");
  try {
    return await fetchWatchedPostsLast24hUnlocked();
  } finally {
    await releaseAccountLease("fetchWatchedPostsLast24h", lease);
  }
}

export async function fetchMentions() {
  const lease = await acquireAccountLease("fetchMentions", 300);
  if (!lease) throw new Error("A refresh for this account is already running");
  try {
    return await fetchMentionsUnlocked();
  } finally {
    await releaseAccountLease("fetchMentions", lease);
  }
}
