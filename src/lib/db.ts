import { MongoClient, ObjectId, type Collection, type Db } from "mongodb";
import fs from "fs";
import path from "path";

/** On Vercel/serverless the app filesystem is read-only; use /tmp for uploads. */
export function getDataDir() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join("/tmp", "socialpost-data");
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

export function getUploadsDir() {
  return path.join(getDataDir(), "uploads");
}

function ensureDataDirs() {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.mkdirSync(getUploadsDir(), { recursive: true });
  } catch {
    // Vercel build / read-only hosts: dirs are created lazily on upload.
  }
}

ensureDataDirs();

const SETTINGS_ID = "app";

export type UserRole = "admin" | "posting";

export type UserDoc = {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type Settings = {
  x_api_key: string;
  x_api_secret: string;
  x_access_token: string;
  x_access_secret: string;
  x_bearer_token: string;
  x_oauth_expires_at: string;
  x_redirect_uri: string;
  x_connected_handle: string;
  openai_api_key: string;
  openai_model: string;
  watched_handles: string[];
  own_handle: string;
  reply_system_prompt: string;
  compose_system_prompt: string;
  topic_keywords: string[];
  keyword_exact_match: boolean;
  min_like_count: number;
  min_reply_count: number;
  min_repost_count: number;
  enable_topic_search: boolean;
  updated_at: string;
};

type SettingsDoc = Omit<Settings, "updated_at"> & {
  _id: string;
  updated_at: Date;
};

export type FetchedPost = {
  id: string;
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
  fetched_at: string;
};

type FetchedPostDoc = {
  _id: ObjectId;
  x_post_id: string;
  author_id: string | null;
  author_handle: string;
  author_name: string | null;
  content: string;
  media_urls: string[];
  like_count: number;
  reply_count: number;
  repost_count: number;
  posted_at: Date | null;
  fetched_at: Date;
};

export type Draft = {
  id: string;
  type: "reply" | "original";
  reply_to_x_id: string | null;
  reply_to_handle: string | null;
  reply_to_content: string | null;
  content: string;
  media_paths: string[];
  status: "draft" | "scheduled" | "posted" | "failed";
  scheduled_at: string | null;
  posted_at: string | null;
  x_post_id: string | null;
  error: string | null;
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
};

type DraftDoc = {
  _id: ObjectId;
  type: "reply" | "original";
  reply_to_x_id: string | null;
  reply_to_handle: string | null;
  reply_to_content: string | null;
  content: string;
  media_paths: string[];
  status: "draft" | "scheduled" | "posted" | "failed";
  scheduled_at: Date | null;
  posted_at: Date | null;
  x_post_id: string | null;
  error: string | null;
  created_by_user_id: ObjectId | null;
  created_at: Date;
  updated_at: Date;
};

type JobRunDoc = {
  _id?: ObjectId;
  job: string;
  status: string;
  detail: string | null;
  ran_at: Date;
};

const DEFAULT_SETTINGS: Omit<SettingsDoc, "_id" | "updated_at"> = {
  x_api_key: "",
  x_api_secret: "",
  x_access_token: "",
  x_access_secret: "",
  x_bearer_token: "",
  x_oauth_expires_at: "",
  x_redirect_uri: "",
  x_connected_handle: "",
  openai_api_key: "",
  openai_model: "gpt-4o-mini",
  watched_handles: [],
  own_handle: "",
  reply_system_prompt: "",
  compose_system_prompt: "",
  topic_keywords: [],
  keyword_exact_match: true,
  min_like_count: 0,
  min_reply_count: 0,
  min_repost_count: 0,
  enable_topic_search: false,
};

const globalForMongo = globalThis as unknown as {
  __mongoClient?: MongoClient;
  __mongoDb?: Db;
  __mongoIndexes?: Promise<void>;
};

function requireUri() {
  const raw = process.env.MONGODB_URI?.trim();
  if (!raw) {
    throw new Error(
      "MONGODB_URI is not set. Add it in Vercel Project Settings → Environment Variables.",
    );
  }
  // Vercel UI sometimes stores values wrapped in quotes
  return raw.replace(/^['"]|['"]$/g, "");
}

function formatMongoError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/MONGODB_URI is not set/i.test(msg)) return msg;
  if (/ENOTFOUND|querySrv|getaddrinfo/i.test(msg)) {
    return "Cannot reach MongoDB host (DNS). Check MONGODB_URI and Atlas Network Access.";
  }
  if (/authentication failed|bad auth|SCRAM/i.test(msg)) {
    return "MongoDB authentication failed. Check username/password in MONGODB_URI.";
  }
  if (/server selection timed out|timed out|Timeout/i.test(msg)) {
    return "MongoDB connection timed out. Allow Vercel IPs in Atlas Network Access (0.0.0.0/0), then redeploy.";
  }
  if (/SSL|TLS|certificate/i.test(msg)) {
    return `MongoDB TLS error: ${msg}`;
  }
  return `MongoDB error: ${msg}`;
}

export async function getMongo(): Promise<Db> {
  if (globalForMongo.__mongoDb) return globalForMongo.__mongoDb;

  try {
    const uri = requireUri();
    const client =
      globalForMongo.__mongoClient ??
      new MongoClient(uri, {
        serverSelectionTimeoutMS: 8000,
        connectTimeoutMS: 8000,
      });

    if (!globalForMongo.__mongoClient) {
      globalForMongo.__mongoClient = client;
      await client.connect();
    }

    const dbName = process.env.MONGODB_DB?.trim() || undefined;
    const db = client.db(dbName);
    globalForMongo.__mongoDb = db;

    if (!globalForMongo.__mongoIndexes) {
      globalForMongo.__mongoIndexes = ensureIndexes(db).catch((err) => {
        globalForMongo.__mongoIndexes = undefined;
        throw err;
      });
    }
    await globalForMongo.__mongoIndexes;

    return db;
  } catch (err) {
    globalForMongo.__mongoClient = undefined;
    globalForMongo.__mongoDb = undefined;
    globalForMongo.__mongoIndexes = undefined;
    throw new Error(formatMongoError(err));
  }
}

async function ensureIndexes(db: Db) {
  await db.collection("users").createIndex({ email: 1 }, { unique: true });
  await db
    .collection("fetched_posts")
    .createIndex({ x_post_id: 1 }, { unique: true });
  await db.collection("fetched_posts").createIndex({ posted_at: -1 });
  await db.collection("drafts").createIndex({ status: 1, scheduled_at: 1 });
  await db.collection("job_runs").createIndex({ ran_at: -1 });

  const settings = db.collection<SettingsDoc>("settings");
  const existing = await settings.findOne({ _id: SETTINGS_ID });
  if (!existing) {
    await settings.insertOne({
      _id: SETTINGS_ID,
      ...DEFAULT_SETTINGS,
      updated_at: new Date(),
    });
  }
}

function usersCol(db: Db): Collection<UserDoc> {
  return db.collection<UserDoc>("users");
}

function settingsCol(db: Db): Collection<SettingsDoc> {
  return db.collection<SettingsDoc>("settings");
}

function postsCol(db: Db): Collection<FetchedPostDoc> {
  return db.collection<FetchedPostDoc>("fetched_posts");
}

function draftsCol(db: Db): Collection<DraftDoc> {
  return db.collection<DraftDoc>("drafts");
}

function jobsCol(db: Db): Collection<JobRunDoc> {
  return db.collection<JobRunDoc>("job_runs");
}

function toIso(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString();
}

function parseDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
}

function mapSettings(doc: SettingsDoc): Settings {
  return {
    x_api_key: doc.x_api_key ?? "",
    x_api_secret: doc.x_api_secret ?? "",
    x_access_token: doc.x_access_token ?? "",
    x_access_secret: doc.x_access_secret ?? "",
    x_bearer_token: doc.x_bearer_token ?? "",
    x_oauth_expires_at: doc.x_oauth_expires_at ?? "",
    x_redirect_uri: doc.x_redirect_uri ?? "",
    x_connected_handle: doc.x_connected_handle ?? "",
    openai_api_key: doc.openai_api_key ?? "",
    openai_model: doc.openai_model || "gpt-4o-mini",
    watched_handles: Array.isArray(doc.watched_handles) ? doc.watched_handles : [],
    own_handle: doc.own_handle ?? "",
    reply_system_prompt: doc.reply_system_prompt ?? "",
    compose_system_prompt: doc.compose_system_prompt ?? "",
    topic_keywords: Array.isArray(doc.topic_keywords) ? doc.topic_keywords : [],
    keyword_exact_match: Boolean(doc.keyword_exact_match),
    min_like_count: Number(doc.min_like_count) || 0,
    min_reply_count: Number(doc.min_reply_count) || 0,
    min_repost_count: Number(doc.min_repost_count) || 0,
    enable_topic_search: Boolean(doc.enable_topic_search),
    updated_at: toIso(doc.updated_at) ?? new Date().toISOString(),
  };
}

function mapPost(doc: FetchedPostDoc): FetchedPost {
  return {
    id: doc._id.toHexString(),
    x_post_id: doc.x_post_id,
    author_id: doc.author_id,
    author_handle: doc.author_handle,
    author_name: doc.author_name,
    content: doc.content,
    media_urls: doc.media_urls ?? [],
    like_count: doc.like_count ?? 0,
    reply_count: doc.reply_count ?? 0,
    repost_count: doc.repost_count ?? 0,
    posted_at: toIso(doc.posted_at),
    fetched_at: toIso(doc.fetched_at) ?? new Date().toISOString(),
  };
}

function mapDraft(doc: DraftDoc): Draft {
  return {
    id: doc._id.toHexString(),
    type: doc.type,
    reply_to_x_id: doc.reply_to_x_id,
    reply_to_handle: doc.reply_to_handle,
    reply_to_content: doc.reply_to_content,
    content: doc.content,
    media_paths: doc.media_paths ?? [],
    status: doc.status,
    scheduled_at: toIso(doc.scheduled_at),
    posted_at: toIso(doc.posted_at),
    x_post_id: doc.x_post_id,
    error: doc.error,
    created_by_user_id: doc.created_by_user_id
      ? doc.created_by_user_id.toHexString()
      : null,
    created_at: toIso(doc.created_at) ?? new Date().toISOString(),
    updated_at: toIso(doc.updated_at) ?? new Date().toISOString(),
  };
}

export function publicUser(user: UserDoc) {
  return {
    id: user._id.toHexString(),
    email: user.email,
    role: user.role,
    active: user.active,
    created_at: toIso(user.createdAt) ?? new Date().toISOString(),
  };
}

export async function getSettings(): Promise<Settings> {
  const db = await getMongo();
  const doc = await settingsCol(db).findOne({ _id: SETTINGS_ID });
  if (!doc) {
    const fresh: SettingsDoc = {
      _id: SETTINGS_ID,
      ...DEFAULT_SETTINGS,
      updated_at: new Date(),
    };
    await settingsCol(db).insertOne(fresh);
    return mapSettings(fresh);
  }
  return mapSettings(doc);
}

export async function updateSettings(
  patch: Partial<Omit<Settings, "updated_at">>,
): Promise<Settings> {
  const db = await getMongo();
  await settingsCol(db).updateOne(
    { _id: SETTINGS_ID },
    { $set: { ...patch, updated_at: new Date() } },
    { upsert: true },
  );
  return getSettings();
}

export async function saveOAuthTokens(opts: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  handle?: string | null;
}) {
  const expiresAt =
    opts.expiresIn && opts.expiresIn > 0
      ? new Date(Date.now() + opts.expiresIn * 1000).toISOString()
      : "";

  const patch: Partial<Settings> = {
    x_access_token: opts.accessToken,
    x_oauth_expires_at: expiresAt,
  };
  if (opts.refreshToken) patch.x_access_secret = opts.refreshToken;
  if (opts.handle) patch.x_connected_handle = opts.handle;

  await updateSettings(patch);

  if (opts.handle) {
    const s = await getSettings();
    if (!s.own_handle) {
      await updateSettings({ own_handle: opts.handle });
    }
  }
}

export async function countUsers(): Promise<number> {
  const db = await getMongo();
  return usersCol(db).countDocuments();
}

export async function findUserByEmail(email: string): Promise<UserDoc | null> {
  const db = await getMongo();
  return usersCol(db).findOne({ email: email.toLowerCase() });
}

export async function findUserById(id: string): Promise<UserDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getMongo();
  return usersCol(db).findOne({ _id: new ObjectId(id) });
}

export async function createUser(opts: {
  email: string;
  passwordHash: string;
  role: UserRole;
}): Promise<UserDoc> {
  const db = await getMongo();
  const now = new Date();
  const doc: UserDoc = {
    _id: new ObjectId(),
    email: opts.email.toLowerCase(),
    passwordHash: opts.passwordHash,
    role: opts.role,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  await usersCol(db).insertOne(doc);
  return doc;
}

export async function listUsers(): Promise<UserDoc[]> {
  const db = await getMongo();
  return usersCol(db).find({}).sort({ createdAt: 1 }).toArray();
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<UserDoc, "role" | "active" | "passwordHash">>,
): Promise<UserDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getMongo();
  const result = await usersCol(db).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set: { ...patch, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  return result ?? null;
}

export async function countActiveAdmins(): Promise<number> {
  const db = await getMongo();
  return usersCol(db).countDocuments({ role: "admin", active: true });
}

export async function upsertFetchedPost(row: {
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
}): Promise<boolean> {
  const db = await getMongo();
  const now = new Date();
  const result = await postsCol(db).updateOne(
    { x_post_id: row.x_post_id },
    {
      $set: {
        author_id: row.author_id,
        author_handle: row.author_handle,
        author_name: row.author_name,
        content: row.content,
        media_urls: row.media_urls,
        like_count: row.like_count,
        reply_count: row.reply_count,
        repost_count: row.repost_count,
        posted_at: parseDate(row.posted_at),
        fetched_at: now,
      },
      $setOnInsert: {
        x_post_id: row.x_post_id,
      },
    },
    { upsert: true },
  );
  return result.upsertedCount > 0 || result.modifiedCount > 0;
}

export async function deleteOldFetchedPosts(olderThanHours: number) {
  const db = await getMongo();
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  await postsCol(db).deleteMany({
    posted_at: { $ne: null, $lt: cutoff },
  });
}

export async function listFetchedPostsSince(
  hours: number,
  limit = 300,
): Promise<FetchedPost[]> {
  const db = await getMongo();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const docs = await postsCol(db)
    .find({
      $or: [{ posted_at: null }, { posted_at: { $gte: since } }],
    })
    .sort({ posted_at: -1 })
    .limit(limit)
    .toArray();
  return docs.map(mapPost);
}

export async function deleteFetchedPostById(id: string) {
  if (!ObjectId.isValid(id)) return;
  const db = await getMongo();
  await postsCol(db).deleteOne({ _id: new ObjectId(id) });
}

export async function listDrafts(): Promise<Draft[]> {
  const db = await getMongo();
  const docs = await draftsCol(db).find({}).toArray();
  const statusOrder: Record<string, number> = {
    scheduled: 0,
    draft: 1,
    failed: 2,
    posted: 3,
  };
  docs.sort((a, b) => {
    const sa = statusOrder[a.status] ?? 9;
    const sb = statusOrder[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    const ta = (a.scheduled_at ?? a.updated_at).getTime();
    const tb = (b.scheduled_at ?? b.updated_at).getTime();
    return tb - ta;
  });
  return docs.map(mapDraft);
}

export async function findDraftById(id: string): Promise<Draft | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getMongo();
  const doc = await draftsCol(db).findOne({ _id: new ObjectId(id) });
  return doc ? mapDraft(doc) : null;
}

export async function createDraft(input: {
  type: "reply" | "original";
  content: string;
  reply_to_x_id?: string | null;
  reply_to_handle?: string | null;
  reply_to_content?: string | null;
  media_paths?: string[];
  status: "draft" | "scheduled";
  scheduled_at?: string | null;
  created_by_user_id?: string | null;
}): Promise<Draft> {
  const db = await getMongo();
  const now = new Date();
  const doc: DraftDoc = {
    _id: new ObjectId(),
    type: input.type,
    reply_to_x_id: input.reply_to_x_id ?? null,
    reply_to_handle: input.reply_to_handle ?? null,
    reply_to_content: input.reply_to_content ?? null,
    content: input.content,
    media_paths: input.media_paths ?? [],
    status: input.status,
    scheduled_at: parseDate(input.scheduled_at ?? null),
    posted_at: null,
    x_post_id: null,
    error: null,
    created_by_user_id:
      input.created_by_user_id && ObjectId.isValid(input.created_by_user_id)
        ? new ObjectId(input.created_by_user_id)
        : null,
    created_at: now,
    updated_at: now,
  };
  await draftsCol(db).insertOne(doc);
  return mapDraft(doc);
}

export async function updateDraft(
  id: string,
  patch: Partial<{
    content: string;
    media_paths: string[];
    status: Draft["status"];
    scheduled_at: string | null;
    posted_at: string | null;
    x_post_id: string | null;
    error: string | null;
  }>,
): Promise<Draft | null> {
  if (!ObjectId.isValid(id)) return null;
  const db = await getMongo();
  const $set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.content !== undefined) $set.content = patch.content;
  if (patch.media_paths !== undefined) $set.media_paths = patch.media_paths;
  if (patch.status !== undefined) $set.status = patch.status;
  if (patch.scheduled_at !== undefined) {
    $set.scheduled_at = parseDate(patch.scheduled_at);
  }
  if (patch.posted_at !== undefined) $set.posted_at = parseDate(patch.posted_at);
  if (patch.x_post_id !== undefined) $set.x_post_id = patch.x_post_id;
  if (patch.error !== undefined) $set.error = patch.error;

  const result = await draftsCol(db).findOneAndUpdate(
    { _id: new ObjectId(id) },
    { $set },
    { returnDocument: "after" },
  );
  return result ? mapDraft(result) : null;
}

export async function deleteDraft(id: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const db = await getMongo();
  const result = await draftsCol(db).deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}

export async function listDueDrafts(): Promise<Draft[]> {
  const db = await getMongo();
  const now = new Date();
  const docs = await draftsCol(db)
    .find({
      status: "scheduled",
      scheduled_at: { $ne: null, $lte: now },
    })
    .sort({ scheduled_at: 1 })
    .toArray();
  return docs.map(mapDraft);
}

export async function logJob(job: string, status: string, detail?: string) {
  const db = await getMongo();
  await jobsCol(db).insertOne({
    job,
    status,
    detail: detail ?? null,
    ran_at: new Date(),
  });
}

/** @deprecated kept for callers that still pass JSON strings during transition */
export function parseJsonArray(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
