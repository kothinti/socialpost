import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "socialpost.db");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

const globalForDb = globalThis as unknown as { __db?: Database.Database };

function ensureColumn(db: Database.Database, table: string, column: string, type: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function createDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      x_api_key TEXT DEFAULT '',
      x_api_secret TEXT DEFAULT '',
      x_access_token TEXT DEFAULT '',
      x_access_secret TEXT DEFAULT '',
      x_bearer_token TEXT DEFAULT '',
      openai_api_key TEXT DEFAULT '',
      openai_model TEXT DEFAULT 'gpt-4o-mini',
      watched_handles TEXT DEFAULT '[]',
      own_handle TEXT DEFAULT '',
      reply_system_prompt TEXT DEFAULT '',
      compose_system_prompt TEXT DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO settings (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS fetched_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      x_post_id TEXT NOT NULL UNIQUE,
      author_id TEXT,
      author_handle TEXT NOT NULL,
      author_name TEXT,
      content TEXT NOT NULL,
      media_urls TEXT DEFAULT '[]',
      like_count INTEGER DEFAULT 0,
      reply_count INTEGER DEFAULT 0,
      repost_count INTEGER DEFAULT 0,
      posted_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('reply', 'original')),
      reply_to_x_id TEXT,
      reply_to_handle TEXT,
      reply_to_content TEXT,
      content TEXT NOT NULL DEFAULT '',
      media_paths TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'posted', 'failed')),
      scheduled_at TEXT,
      posted_at TEXT,
      x_post_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // OAuth 2.0 extras (x_api_key/secret = Client ID/Secret;
  // x_access_token/secret = user access/refresh tokens)
  ensureColumn(db, "settings", "x_oauth_expires_at", "TEXT DEFAULT ''");
  ensureColumn(db, "settings", "x_redirect_uri", "TEXT DEFAULT ''");
  ensureColumn(db, "settings", "x_connected_handle", "TEXT DEFAULT ''");

  return db;
}

export function getDb() {
  if (!globalForDb.__db) {
    globalForDb.__db = createDb();
  }
  return globalForDb.__db;
}

export type Settings = {
  id: number;
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
  watched_handles: string;
  own_handle: string;
  reply_system_prompt: string;
  compose_system_prompt: string;
  updated_at: string;
};

export type FetchedPost = {
  id: number;
  x_post_id: string;
  author_id: string | null;
  author_handle: string;
  author_name: string | null;
  content: string;
  media_urls: string;
  like_count: number;
  reply_count: number;
  repost_count: number;
  posted_at: string | null;
  fetched_at: string;
};

export type Draft = {
  id: number;
  type: "reply" | "original";
  reply_to_x_id: string | null;
  reply_to_handle: string | null;
  reply_to_content: string | null;
  content: string;
  media_paths: string;
  status: "draft" | "scheduled" | "posted" | "failed";
  scheduled_at: string | null;
  posted_at: string | null;
  x_post_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export function getSettings(): Settings {
  return getDb().prepare("SELECT * FROM settings WHERE id = 1").get() as Settings;
}

export function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function saveOAuthTokens(opts: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  handle?: string | null;
}) {
  const expiresAt =
    opts.expiresIn && opts.expiresIn > 0
      ? new Date(Date.now() + opts.expiresIn * 1000).toISOString()
      : "";

  getDb()
    .prepare(
      `UPDATE settings SET
        x_access_token = ?,
        x_access_secret = COALESCE(?, x_access_secret),
        x_oauth_expires_at = ?,
        x_connected_handle = COALESCE(?, x_connected_handle),
        updated_at = datetime('now')
      WHERE id = 1`,
    )
    .run(
      opts.accessToken,
      opts.refreshToken ?? null,
      expiresAt,
      opts.handle ?? null,
    );
}
