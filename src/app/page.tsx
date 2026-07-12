"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Tab = "feed" | "compose" | "queue" | "settings";

type FeedPost = {
  id: number;
  x_post_id: string;
  author_handle: string;
  author_name: string | null;
  content: string;
  media_urls: string[];
  like_count: number;
  reply_count: number;
  repost_count: number;
  posted_at: string | null;
};

type Draft = {
  id: number;
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
  updated_at: string;
};

type Settings = {
  openai_model: string;
  watched_handles: string[];
  own_handle: string;
  reply_system_prompt: string;
  compose_system_prompt: string;
  has_x_client_id: boolean;
  has_x_client_secret: boolean;
  has_x_bearer_token: boolean;
  has_x_user_token: boolean;
  has_openai_api_key: boolean;
  x_connected_handle: string;
  x_redirect_uri: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data as T;
}

function formatWhen(iso: string | null) {
  if (!iso) return "";
  const normalized =
    iso.endsWith("Z") || iso.includes("T") || iso.includes("+")
      ? iso
      : iso.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalInputValue(iso: string | null) {
  if (!iso) {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  }
  const d = new Date(iso.endsWith("Z") || iso.includes("+") || iso.includes("T") ? iso : iso + "Z");
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string) {
  return new Date(value).toISOString();
}

export default function HomePage() {
  const [tab, setTab] = useState<Tab>("feed");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selected, setSelected] = useState<FeedPost | null>(null);
  const [composerMode, setComposerMode] = useState<"reply" | "original">("reply");
  const [content, setContent] = useState("");
  const [instruction, setInstruction] = useState("");
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState(toLocalInputValue(null));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handlesText, setHandlesText] = useState("");
  const [settingsForm, setSettingsForm] = useState({
    openai_model: "gpt-4o-mini",
    own_handle: "",
    x_client_id: "",
    x_client_secret: "",
    x_bearer_token: "",
    x_redirect_uri: "http://127.0.0.1:3000/api/auth/x/callback",
    openai_api_key: "",
    reply_system_prompt: "",
    compose_system_prompt: "",
  });

  const loadAll = useCallback(async () => {
    const [feed, draftData, settingsData] = await Promise.all([
      api<{ posts: FeedPost[] }>("/api/feed"),
      api<{ drafts: Draft[] }>("/api/drafts"),
      api<Settings>("/api/settings"),
    ]);
    setPosts(feed.posts);
    setDrafts(draftData.drafts);
    setSettings(settingsData);
    setHandlesText(settingsData.watched_handles.map((h) => `@${h}`).join("\n"));
    setSettingsForm((prev) => ({
      ...prev,
      openai_model: settingsData.openai_model,
      own_handle: settingsData.own_handle,
      x_redirect_uri: settingsData.x_redirect_uri,
      reply_system_prompt: settingsData.reply_system_prompt,
      compose_system_prompt: settingsData.compose_system_prompt,
    }));
  }, []);

  useEffect(() => {
    loadAll().catch((err) => setError(err.message));
  }, [loadAll]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (tabParam === "settings" || tabParam === "feed" || tabParam === "compose" || tabParam === "queue") {
      setTab(tabParam);
    }
    const xerror = params.get("xerror");
    const xconnected = params.get("xconnected");
    if (xerror) setError(decodeURIComponent(xerror));
    if (xconnected) {
      flash(xconnected === "1" ? "Connected to X" : `Connected as @${decodeURIComponent(xconnected)}`);
      loadAll().catch(() => undefined);
    }
    if (tabParam || xerror || xconnected) {
      window.history.replaceState({}, "", "/");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const charCount = content.length;
  const charClass =
    charCount > 280 ? "char-over" : charCount > 240 ? "char-warn" : "muted";

  const queue = useMemo(
    () => drafts.filter((d) => d.status === "scheduled" || d.status === "failed" || d.status === "draft"),
    [drafts],
  );

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3200);
  }

  function selectPost(post: FeedPost) {
    setSelected(post);
    setComposerMode("reply");
    setTab("feed");
    setInstruction("");
  }

  async function refreshFeed() {
    setBusy("refresh");
    setError(null);
    try {
      const result = await api<{ scanned: number; inserted: number }>("/api/feed/refresh", {
        method: "POST",
      });
      await loadAll();
      flash(`Fetched ${result.scanned} posts · ${result.inserted} updated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      if (composerMode === "reply") {
        if (!selected) throw new Error("Select a post first");
        const data = await api<{ text: string }>("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "reply",
            postContent: selected.content,
            authorHandle: selected.author_handle,
            instruction: instruction || undefined,
          }),
        });
        setContent(data.text);
      } else {
        if (!originalPrompt.trim()) throw new Error("Add a prompt for the model");
        const data = await api<{ text: string }>("/api/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "original", prompt: originalPrompt }),
        });
        setContent(data.text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setBusy(null);
    }
  }

  async function uploadMedia(file: File) {
    const form = new FormData();
    form.append("file", file);
    setBusy("upload");
    setError(null);
    try {
      const data = await api<{ path: string }>("/api/media", { method: "POST", body: form });
      setMediaPaths((prev) => [...prev, data.path]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndAct(action: "draft" | "schedule" | "post") {
    if (!content.trim()) {
      setError("Write something first");
      return;
    }
    if (composerMode === "reply" && !selected) {
      setError("Select a post to reply to");
      return;
    }

    setBusy(action);
    setError(null);
    try {
      const created = await api<{ draft: Draft }>("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: composerMode,
          content,
          media_paths: mediaPaths,
          reply_to_x_id: selected?.x_post_id,
          reply_to_handle: selected?.author_handle,
          reply_to_content: selected?.content,
          status: action === "schedule" ? "scheduled" : "draft",
          scheduled_at: action === "schedule" ? fromLocalInputValue(scheduleAt) : null,
        }),
      });

      if (action === "post") {
        await api("/api/drafts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: created.draft.id, action: "post" }),
        });
        flash("Posted to X");
      } else if (action === "schedule") {
        flash("Scheduled");
      } else {
        flash("Saved draft");
      }

      setContent("");
      setMediaPaths([]);
      setInstruction("");
      await loadAll();
      if (action !== "draft") setTab("queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function draftAction(id: number, action: "post" | "delete") {
    setBusy(`draft-${id}`);
    setError(null);
    try {
      await api("/api/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await loadAll();
      flash(action === "post" ? "Posted" : "Deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    setBusy("settings");
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        openai_model: settingsForm.openai_model,
        own_handle: settingsForm.own_handle,
        x_redirect_uri: settingsForm.x_redirect_uri.trim(),
        watched_handles: handlesText
          .split(/[\n,]+/)
          .map((h) => h.trim())
          .filter(Boolean),
        reply_system_prompt: settingsForm.reply_system_prompt,
        compose_system_prompt: settingsForm.compose_system_prompt,
      };
      for (const key of [
        "x_client_id",
        "x_client_secret",
        "x_bearer_token",
        "openai_api_key",
      ] as const) {
        if (settingsForm[key].trim()) payload[key] = settingsForm[key].trim();
      }
      const updated = await api<Settings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setSettings(updated);
      setSettingsForm((prev) => ({
        ...prev,
        x_client_id: "",
        x_client_secret: "",
        x_bearer_token: "",
        openai_api_key: "",
        x_redirect_uri: updated.x_redirect_uri,
      }));
      flash("Settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function testX() {
    setBusy("test-x");
    setError(null);
    try {
      const res = await fetch("/api/settings/test-x", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.message || data.error || "X auth failed");
      }
      flash(data.message || "X credentials OK");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "X test failed");
    } finally {
      setBusy(null);
    }
  }

  function connectX() {
    window.location.href = "/api/auth/x/start";
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl fade-in">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1
              className="text-4xl md:text-5xl tracking-tight"
              style={{ fontFamily: "var(--font-syne), sans-serif" }}
            >
              SocialPost
            </h1>
            <p className="muted mt-2 text-sm md:text-base max-w-xl">
              Pull last-day posts, draft AI replies, and post or schedule to your handle.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {settings?.own_handle ? (
              <span
                className="muted text-sm px-3 py-1.5 rounded-full border"
                style={{ borderColor: "var(--border-strong)", fontFamily: "var(--font-ibm), monospace" }}
              >
                @{settings.own_handle}
              </span>
            ) : null}
            <button className="btn btn-ghost" onClick={logout} type="button">
              Sign out
            </button>
          </div>
        </header>

        <nav className="flex flex-wrap gap-2 mb-6">
          {(
            [
              ["feed", "Feed"],
              ["compose", "Compose"],
              ["queue", "Queue"],
              ["settings", "Settings"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn"
              onClick={() => {
                setTab(id);
                if (id === "compose") setComposerMode("original");
              }}
              style={
                tab === id
                  ? { background: "var(--accent)", color: "var(--accent-ink)" }
                  : {
                      background: "transparent",
                      border: "1px solid var(--border-strong)",
                      color: "var(--text)",
                    }
              }
            >
              {label}
            </button>
          ))}
        </nav>

        {(notice || error) && (
          <div className="mb-4 text-sm">
            {notice ? <p style={{ color: "var(--ok)" }}>{notice}</p> : null}
            {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
          </div>
        )}

        {tab === "feed" && (
          <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="panel p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg" style={{ fontFamily: "var(--font-syne), sans-serif" }}>
                    Last 24 hours
                  </h2>
                  <p className="muted text-sm">From your watched handles</p>
                </div>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={refreshFeed}
                  disabled={busy === "refresh"}
                >
                  {busy === "refresh" ? "Fetching…" : "Refresh now"}
                </button>
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                {posts.length === 0 ? (
                  <p className="muted text-sm py-10 text-center">
                    No posts yet. Add handles in Settings, then refresh.
                  </p>
                ) : (
                  posts.map((post) => (
                    <button
                      key={post.x_post_id}
                      type="button"
                      className="feed-item w-full text-left rounded-xl border p-4"
                      style={{ borderColor: "var(--border)" }}
                      data-active={selected?.x_post_id === post.x_post_id}
                      onClick={() => selectPost(post)}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-2">
                        <span style={{ fontFamily: "var(--font-ibm), monospace" }} className="text-sm">
                          @{post.author_handle}
                        </span>
                        <span className="muted text-xs">{formatWhen(post.posted_at)}</span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.content}</p>
                      <div className="muted text-xs mt-3 flex gap-3">
                        <span>{post.like_count} likes</span>
                        <span>{post.reply_count} replies</span>
                        <span>{post.repost_count} reposts</span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <Composer
              mode={composerMode}
              setMode={setComposerMode}
              selected={selected}
              content={content}
              setContent={setContent}
              instruction={instruction}
              setInstruction={setInstruction}
              originalPrompt={originalPrompt}
              setOriginalPrompt={setOriginalPrompt}
              mediaPaths={mediaPaths}
              setMediaPaths={setMediaPaths}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              charClass={charClass}
              charCount={charCount}
              busy={busy}
              onGenerate={generate}
              onUpload={uploadMedia}
              onAct={saveAndAct}
            />
          </section>
        )}

        {tab === "compose" && (
          <section className="max-w-2xl">
            <Composer
              mode="original"
              setMode={() => setComposerMode("original")}
              selected={null}
              forceOriginal
              content={content}
              setContent={setContent}
              instruction={instruction}
              setInstruction={setInstruction}
              originalPrompt={originalPrompt}
              setOriginalPrompt={setOriginalPrompt}
              mediaPaths={mediaPaths}
              setMediaPaths={setMediaPaths}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              charClass={charClass}
              charCount={charCount}
              busy={busy}
              onGenerate={generate}
              onUpload={uploadMedia}
              onAct={saveAndAct}
            />
          </section>
        )}

        {tab === "queue" && (
          <section className="panel p-4 md:p-5">
            <h2 className="text-lg mb-1" style={{ fontFamily: "var(--font-syne), sans-serif" }}>
              Queue
            </h2>
            <p className="muted text-sm mb-5">Drafts, schedules, and recent failures</p>
            <div className="space-y-3">
              {queue.length === 0 ? (
                <p className="muted text-sm py-8 text-center">Nothing in the queue.</p>
              ) : (
                queue.map((d) => (
                  <div
                    key={d.id}
                    className="rounded-xl border p-4"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span
                          className="px-2 py-0.5 rounded-full border text-xs uppercase tracking-wide"
                          style={{ borderColor: "var(--border-strong)" }}
                        >
                          {d.status}
                        </span>
                        <span className="muted">
                          {d.type === "reply" ? `Reply to @${d.reply_to_handle}` : "Original"}
                        </span>
                      </div>
                      <span className="muted text-xs">
                        {d.scheduled_at
                          ? `Scheduled ${formatWhen(d.scheduled_at)}`
                          : formatWhen(d.updated_at)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap mb-3">{d.content}</p>
                    {d.error ? (
                      <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
                        {d.error}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      {d.status !== "posted" ? (
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={busy === `draft-${d.id}`}
                          onClick={() => draftAction(d.id, "post")}
                        >
                          Post now
                        </button>
                      ) : null}
                      <button
                        className="btn btn-danger"
                        type="button"
                        disabled={busy === `draft-${d.id}`}
                        onClick={() => draftAction(d.id, "delete")}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {tab === "settings" && settings && (
          <section className="panel p-4 md:p-6 max-w-3xl space-y-6">
            <div>
              <h2 className="text-lg" style={{ fontFamily: "var(--font-syne), sans-serif" }}>
                Settings
              </h2>
              <p className="muted text-sm">Keys stay on this machine in SQLite. Leave blank to keep existing.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <label className="space-y-1.5 block">
                <span className="text-sm muted">Your handle</span>
                <input
                  className="field"
                  value={settingsForm.own_handle}
                  onChange={(e) => setSettingsForm({ ...settingsForm, own_handle: e.target.value })}
                  placeholder="yourhandle"
                />
              </label>
              <label className="space-y-1.5 block">
                <span className="text-sm muted">OpenAI model</span>
                <input
                  className="field"
                  value={settingsForm.openai_model}
                  onChange={(e) => setSettingsForm({ ...settingsForm, openai_model: e.target.value })}
                  placeholder="gpt-4o-mini"
                />
              </label>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-sm muted">Watched handles (one per line)</span>
              <textarea
                className="field min-h-28"
                value={handlesText}
                onChange={(e) => setHandlesText(e.target.value)}
                placeholder={"@elonmusk\n@openai"}
              />
            </label>

            <div>
              <p className="text-sm muted mb-3">
                X OAuth 2.0 — save Client ID / Secret, set the callback in X console, then Connect
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {(
                  [
                    ["x_client_id", "Client ID", settings.has_x_client_id],
                    ["x_client_secret", "Client Secret", settings.has_x_client_secret],
                    ["x_bearer_token", "Bearer Token (read feed)", settings.has_x_bearer_token],
                    ["openai_api_key", "OpenAI API Key", settings.has_openai_api_key],
                  ] as const
                ).map(([key, label, has]) => (
                  <label key={key} className="space-y-1.5 block">
                    <span className="text-sm muted">
                      {label} {has ? "· saved" : ""}
                    </span>
                    <input
                      className="field"
                      type="password"
                      autoComplete="off"
                      value={settingsForm[key]}
                      onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })}
                      placeholder={has ? "••••••••" : ""}
                    />
                  </label>
                ))}
              </div>
              <label className="space-y-1.5 block mt-4">
                <span className="text-sm muted">OAuth callback URL (must match X console exactly)</span>
                <input
                  className="field"
                  value={settingsForm.x_redirect_uri}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, x_redirect_uri: e.target.value })
                  }
                  placeholder="http://127.0.0.1:3000/api/auth/x/callback"
                />
              </label>
              <p className="text-xs muted mt-2">
                In X User authentication settings use type Web App, callback{" "}
                <span style={{ fontFamily: "var(--font-ibm), monospace" }}>
                  {settingsForm.x_redirect_uri || "http://127.0.0.1:3000/api/auth/x/callback"}
                </span>
                . Prefer <code>127.0.0.1</code> over localhost.
              </p>
              <p className="text-sm mt-3">
                {settings.has_x_user_token ? (
                  <span style={{ color: "var(--ok)" }}>
                    Connected{settings.x_connected_handle ? ` as @${settings.x_connected_handle}` : ""}
                  </span>
                ) : (
                  <span className="muted">Not connected — posting requires Connect with X</span>
                )}
              </p>
            </div>

            <label className="space-y-1.5 block">
              <span className="text-sm muted">Reply system prompt (optional)</span>
              <textarea
                className="field min-h-24"
                value={settingsForm.reply_system_prompt}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, reply_system_prompt: e.target.value })
                }
              />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-sm muted">Compose system prompt (optional)</span>
              <textarea
                className="field min-h-24"
                value={settingsForm.compose_system_prompt}
                onChange={(e) =>
                  setSettingsForm({ ...settingsForm, compose_system_prompt: e.target.value })
                }
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary"
                type="button"
                onClick={saveSettings}
                disabled={busy === "settings"}
              >
                {busy === "settings" ? "Saving…" : "Save settings"}
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={connectX}
                disabled={!settings.has_x_client_id || !settings.has_x_client_secret}
              >
                Connect with X
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={testX}
                disabled={busy === "test-x"}
              >
                {busy === "test-x" ? "Testing…" : "Test X auth"}
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function Composer(props: {
  mode: "reply" | "original";
  setMode: (m: "reply" | "original") => void;
  selected: FeedPost | null;
  forceOriginal?: boolean;
  content: string;
  setContent: (v: string) => void;
  instruction: string;
  setInstruction: (v: string) => void;
  originalPrompt: string;
  setOriginalPrompt: (v: string) => void;
  mediaPaths: string[];
  setMediaPaths: (v: string[] | ((p: string[]) => string[])) => void;
  scheduleAt: string;
  setScheduleAt: (v: string) => void;
  charClass: string;
  charCount: number;
  busy: string | null;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onAct: (action: "draft" | "schedule" | "post") => void;
}) {
  useEffect(() => {
    if (props.forceOriginal) props.setMode("original");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceOriginal]);

  return (
    <div className="panel p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg" style={{ fontFamily: "var(--font-syne), sans-serif" }}>
          {props.forceOriginal ? "New post" : "Compose"}
        </h2>
        {!props.forceOriginal ? (
          <div className="flex gap-1">
            <button
              type="button"
              className="btn"
              onClick={() => props.setMode("reply")}
              style={
                props.mode === "reply"
                  ? { background: "var(--accent)", color: "var(--accent-ink)", padding: "0.35rem 0.8rem" }
                  : { border: "1px solid var(--border-strong)", padding: "0.35rem 0.8rem" }
              }
            >
              Reply
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => props.setMode("original")}
              style={
                props.mode === "original"
                  ? { background: "var(--accent)", color: "var(--accent-ink)", padding: "0.35rem 0.8rem" }
                  : { border: "1px solid var(--border-strong)", padding: "0.35rem 0.8rem" }
              }
            >
              Original
            </button>
          </div>
        ) : null}
      </div>

      {props.mode === "reply" ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}
        >
          {props.selected ? (
            <>
              <p className="muted text-xs mb-1">Replying to @{props.selected.author_handle}</p>
              <p className="whitespace-pre-wrap line-clamp-4">{props.selected.content}</p>
            </>
          ) : (
            <p className="muted">Select a post from the feed.</p>
          )}
        </div>
      ) : null}

      {props.mode === "reply" ? (
        <label className="block space-y-1.5">
          <span className="text-sm muted">Instruction for the model</span>
          <input
            className="field"
            value={props.instruction}
            onChange={(e) => props.setInstruction(e.target.value)}
            placeholder="Keep it witty, ask a follow-up…"
          />
        </label>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-sm muted">Prompt</span>
          <textarea
            className="field min-h-24"
            value={props.originalPrompt}
            onChange={(e) => props.setOriginalPrompt(e.target.value)}
            placeholder="What should this post be about?"
          />
        </label>
      )}

      <div className="flex gap-2">
        <button
          className="btn btn-ghost"
          type="button"
          onClick={props.onGenerate}
          disabled={props.busy === "generate"}
        >
          {props.busy === "generate" ? "Generating…" : "Generate with AI"}
        </button>
      </div>

      <label className="block space-y-1.5">
        <div className="flex justify-between">
          <span className="text-sm muted">Editable post</span>
          <span className={`text-xs ${props.charClass}`}>{props.charCount}/280</span>
        </div>
        <textarea
          className="field min-h-36"
          value={props.content}
          onChange={(e) => props.setContent(e.target.value)}
          placeholder="Your reply or post…"
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm muted">Media</span>
          <label className="btn btn-ghost" style={{ padding: "0.35rem 0.8rem" }}>
            Attach
            <input
              type="file"
              className="hidden"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) props.onUpload(file);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {props.mediaPaths.length > 0 ? (
          <ul className="space-y-1">
            {props.mediaPaths.map((p) => (
              <li key={p} className="flex items-center justify-between text-xs muted gap-2">
                <span className="truncate" style={{ fontFamily: "var(--font-ibm), monospace" }}>
                  {p}
                </span>
                <button
                  type="button"
                  className="btn btn-danger"
                  style={{ padding: "0.2rem 0.6rem" }}
                  onClick={() => props.setMediaPaths((prev) => prev.filter((x) => x !== p))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs muted">Optional image or video attachment.</p>
        )}
      </div>

      <label className="block space-y-1.5">
        <span className="text-sm muted">Schedule for</span>
        <input
          className="field"
          type="datetime-local"
          value={props.scheduleAt}
          onChange={(e) => props.setScheduleAt(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          className="btn btn-primary"
          type="button"
          disabled={Boolean(props.busy)}
          onClick={() => props.onAct("post")}
        >
          Post now
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={Boolean(props.busy)}
          onClick={() => props.onAct("schedule")}
        >
          Schedule
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={Boolean(props.busy)}
          onClick={() => props.onAct("draft")}
        >
          Save draft
        </button>
      </div>
    </div>
  );
}
