"use client";

import Image from "next/image";
import { xTextLength, validateXText } from "@/lib/x-text";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Tab = "feed" | "mentions" | "compose" | "queue" | "settings";

type ComposerMode = "reply" | "quote" | "original";

type SettingsTab =
  "editorial" | "x" | "ai" | "feed" | "mentions" | "controls" | "users";

const SETTINGS_TABS: [SettingsTab, string][] = [
  ["x", "X account"],
  ["ai", "AI"],
  ["editorial", "Editorial"],
  ["feed", "Feed"],
  ["mentions", "Mentions"],
  ["controls", "Controls"],
  ["users", "Users"],
];

type FeedPost = {
  id: string;
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

/** A post that @mentions the connected account: the only kind X lets us reply to via API. */
type Mention = {
  id: string;
  x_post_id: string;
  author_handle: string;
  author_name: string | null;
  content: string;
  posted_at: string | null;
  replied_x_post_id: string | null;
};

/** Post being replied to or quoted, and where it came from. */
type Target = {
  source: "feed" | "mention";
  x_post_id: string;
  author_handle: string;
  content: string;
};

type Draft = {
  id: string;
  type: ComposerMode;
  reply_to_x_id: string | null;
  reply_to_handle: string | null;
  reply_to_content: string | null;
  content: string;
  media_paths: string[];
  status:
    | "draft"
    | "scheduled"
    | "posting"
    | "posted"
    | "failed"
    | "pending_approval"
    | "uncertain";
  scheduled_at: string | null;
  posted_at: string | null;
  x_post_id: string | null;
  error: string | null;
  updated_at: string;
};

type Settings = {
  account_id: "company" | "personal";
  publishing_paused: boolean;
  automation_paused: boolean;
  editorial_topics: string;
  editorial_sources: string;
  editorial_style: string;
  editorial_avoid: string;
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
  enable_mentions: boolean;
  mentions_max_results: number;
  has_x_client_id: boolean;
  has_x_client_secret: boolean;
  has_x_bearer_token: boolean;
  has_x_user_token: boolean;
  has_openai_api_key: boolean;
  x_connected_handle: string;
  x_redirect_uri: string;
  read_only?: boolean;
};

type SessionUser = {
  id: string;
  email: string;
  role: "admin" | "posting";
};

type AppUser = {
  id: string;
  email: string;
  role: "admin" | "posting";
  active: boolean;
  created_at: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set(
    "x-account-id",
    new URLSearchParams(window.location.search).get("account") || "company",
  );
  const res = await fetch(url, { ...init, headers });
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
  // Default: the next full hour. datetime-local inputs take local time, so shift
  // by the timezone offset before formatting (toISOString alone would be UTC).
  let d: Date;
  if (iso) {
    d = new Date(
      iso.endsWith("Z") || iso.includes("+") || iso.includes("T")
        ? iso
        : iso + "Z",
    );
  } else {
    d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
  }
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value: string) {
  return new Date(value).toISOString();
}

/** X web intent: opens X's own reply box with the text prefilled; the user clicks Post. */
function replyIntentUrl(inReplyTo: string, text: string) {
  const params = new URLSearchParams({ in_reply_to: inReplyTo, text });
  return `https://x.com/intent/tweet?${params.toString()}`;
}

/** X auto-links bare domains too, and a post with a link costs $0.20 instead of $0.015. */
function containsLink(text: string) {
  return /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|ai|co|dev|app|me|xyz)\b/i.test(
    text,
  );
}

export default function HomePage() {
  const [approvalOnly, setApprovalOnly] = useState(false);
  const [tab, setTab] = useState<Tab>("compose");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("x");
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUser, setNewUser] = useState({
    email: "",
    password: "",
    role: "posting" as "admin" | "posting",
  });
  const [target, setTarget] = useState<Target | null>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode>("original");
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");
  const [mediaPaths, setMediaPaths] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState(toLocalInputValue(null));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handlesText, setHandlesText] = useState("");
  const [keywordsText, setKeywordsText] = useState("");
  const [settingsForm, setSettingsForm] = useState({
    editorial_topics: "",
    editorial_sources: "",
    editorial_style: "",
    editorial_avoid: "",
    openai_model: "gpt-4o-mini",
    own_handle: "",
    x_client_id: "",
    x_client_secret: "",
    x_bearer_token: "",
    x_redirect_uri: "http://127.0.0.1:3000/api/auth/x/callback",
    openai_api_key: "",
    reply_system_prompt: "",
    compose_system_prompt: "",
    keyword_exact_match: true,
    min_like_count: 0,
    min_reply_count: 0,
    min_repost_count: 0,
    enable_topic_search: false,
    enable_mentions: true,
    mentions_max_results: 20,
  });

  const loadAll = useCallback(async () => {
    const [feed, mentionData, draftData, settingsData, me] = await Promise.all([
      api<{ posts: FeedPost[] }>("/api/feed"),
      api<{ mentions: Mention[] }>("/api/mentions"),
      api<{ drafts: Draft[] }>("/api/drafts"),
      api<Settings>("/api/settings"),
      api<{ authenticated: boolean; user: SessionUser | null }>("/api/auth/me"),
    ]);
    setPosts(feed.posts);
    setMentions(mentionData.mentions);
    setDrafts(draftData.drafts);
    setSettings(settingsData);
    setSessionUser(me.user);
    setHandlesText(settingsData.watched_handles.map((h) => `@${h}`).join("\n"));
    setKeywordsText(settingsData.topic_keywords.join("\n"));
    setSettingsForm((prev) => ({
      ...prev,
      editorial_topics: settingsData.editorial_topics,
      editorial_sources: settingsData.editorial_sources,
      editorial_style: settingsData.editorial_style,
      editorial_avoid: settingsData.editorial_avoid,
      openai_model: settingsData.openai_model,
      own_handle: settingsData.own_handle,
      x_redirect_uri: settingsData.x_redirect_uri,
      reply_system_prompt: settingsData.reply_system_prompt,
      compose_system_prompt: settingsData.compose_system_prompt,
      keyword_exact_match: settingsData.keyword_exact_match,
      min_like_count: settingsData.min_like_count,
      min_reply_count: settingsData.min_reply_count,
      min_repost_count: settingsData.min_repost_count,
      enable_topic_search: settingsData.enable_topic_search,
      enable_mentions: settingsData.enable_mentions,
      mentions_max_results: settingsData.mentions_max_results,
    }));

    if (me.user?.role === "admin") {
      try {
        const usersData = await api<{ users: AppUser[] }>("/api/users");
        setUsers(usersData.users);
      } catch {
        setUsers([]);
      }
    }
  }, []);

  useEffect(() => {
    loadAll().catch((err) => setError(err.message));
  }, [loadAll]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get("tab");
    if (
      tabParam === "settings" ||
      tabParam === "feed" ||
      tabParam === "mentions" ||
      tabParam === "compose" ||
      tabParam === "queue"
    ) {
      setTab(tabParam);
    }
    const xerror = params.get("xerror");
    const xconnected = params.get("xconnected");
    if (xerror) setError(decodeURIComponent(xerror));
    if (xconnected) {
      flash(
        xconnected === "1"
          ? "Connected to X"
          : `Connected as @${decodeURIComponent(xconnected)}`,
      );
      loadAll().catch(() => undefined);
    }
    if (tabParam || xerror || xconnected) {
      window.history.replaceState(
        {},
        "",
        `/?account=${params.get("account") === "personal" ? "personal" : "company"}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const charCount = xTextLength(content);
  const charClass =
    charCount > 280 ? "char-over" : charCount > 240 ? "char-warn" : "muted";

  const queue = useMemo(
    () =>
      drafts.filter(
        (d) =>
          d.status !== "posted" &&
          (!approvalOnly || d.status === "pending_approval"),
      ),
    [drafts, approvalOnly],
  );

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3200);
  }

  function selectTarget(post: FeedPost | Mention, source: Target["source"]) {
    setTarget({
      source,
      x_post_id: post.x_post_id,
      author_handle: post.author_handle,
      content: post.content,
    });
    setComposerMode("reply");
    setNotes("");
  }

  async function refreshFeed() {
    setBusy("refresh");
    setError(null);
    try {
      const result = await api<{ scanned: number; inserted: number }>(
        "/api/feed/refresh",
        {
          method: "POST",
        },
      );
      await loadAll();
      flash(`Fetched ${result.scanned} posts · ${result.inserted} updated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(null);
    }
  }

  async function refreshMentions() {
    setBusy("refresh-mentions");
    setError(null);
    try {
      const result = await api<{ fetched: number; skipped?: string }>(
        "/api/mentions/refresh",
        { method: "POST" },
      );
      await loadAll();
      flash(
        result.skipped
          ? `Mentions skipped (${result.skipped})`
          : `${result.fetched} new mention${result.fetched === 1 ? "" : "s"}`,
      );
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
      if (!notes.trim()) throw new Error("Add some notes for the AI first");
      const data = await api<{ text: string }>("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: composerMode, notes }),
      });
      setContent(data.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Compose failed");
    } finally {
      setBusy(null);
    }
  }

  function openReplyInX() {
    if (!target) return;
    if (xTextLength(content) > 280) {
      setError("X's reply box takes at most 280 characters");
      return;
    }
    window.open(
      replyIntentUrl(target.x_post_id, content),
      "_blank",
      "noopener,noreferrer",
    );
  }

  async function uploadMedia(file: File) {
    const form = new FormData();
    form.append("file", file);
    setBusy("upload");
    setError(null);
    try {
      const data = await api<{ path: string }>("/api/media", {
        method: "POST",
        body: form,
      });
      setMediaPaths((prev) => [...prev, data.path]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function saveAndAct(action: "draft" | "schedule" | "post") {
    if (validateXText(content)) {
      setError(validateXText(content));
      return;
    }
    if (action === "schedule" && new Date(scheduleAt).getTime() <= Date.now()) {
      setError("Pick a time in the future to schedule");
      return;
    }
    if (composerMode !== "original" && !target) {
      setError("Select a post first");
      return;
    }
    if (composerMode === "reply" && target?.source !== "mention") {
      setError(
        "X only allows API replies to posts that mention you. Use Open in X.",
      );
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
          reply_to_x_id:
            composerMode === "original" ? undefined : target?.x_post_id,
          reply_to_handle:
            composerMode === "original" ? undefined : target?.author_handle,
          status: action === "schedule" ? "scheduled" : "draft",
          scheduled_at:
            action === "schedule" ? fromLocalInputValue(scheduleAt) : null,
        }),
      });

      if (action === "post") {
        await api("/api/drafts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: created.draft.id,
            action: isAdmin ? "post" : "submit",
          }),
        });
        flash(isAdmin ? "Posted to X" : "Submitted for approval");
      } else if (action === "schedule") {
        flash(isAdmin ? "Scheduled" : "Submitted schedule for approval");
      } else {
        flash("Saved draft");
      }

      setContent("");
      setMediaPaths([]);
      setNotes("");
      await loadAll();
      if (action !== "draft" && tab !== "compose") setTab("queue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  async function draftAction(
    id: string,
    action: "post" | "delete" | "submit" | "approve",
  ) {
    setBusy(`draft-${id}`);
    setError(null);
    try {
      await api("/api/drafts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await loadAll();
      flash(
        action === "post"
          ? "Posted"
          : action === "approve"
            ? "Approved"
            : action === "submit"
              ? "Submitted for approval"
              : "Deleted",
      );
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
        editorial_topics: settingsForm.editorial_topics,
        editorial_sources: settingsForm.editorial_sources,
        editorial_style: settingsForm.editorial_style,
        editorial_avoid: settingsForm.editorial_avoid,
        openai_model: settingsForm.openai_model,
        own_handle: settingsForm.own_handle,
        x_redirect_uri: settingsForm.x_redirect_uri.trim(),
        watched_handles: handlesText
          .split(/[\n,]+/)
          .map((h) => h.trim())
          .filter(Boolean),
        topic_keywords: keywordsText
          .split("\n")
          .map((k) => k.trim())
          .filter(Boolean),
        keyword_exact_match: settingsForm.keyword_exact_match,
        min_like_count: Number(settingsForm.min_like_count) || 0,
        min_reply_count: Number(settingsForm.min_reply_count) || 0,
        min_repost_count: Number(settingsForm.min_repost_count) || 0,
        enable_topic_search: settingsForm.enable_topic_search,
        enable_mentions: settingsForm.enable_mentions,
        mentions_max_results: Number(settingsForm.mentions_max_results) || 20,
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
      setKeywordsText(updated.topic_keywords.join("\n"));
      setSettingsForm((prev) => ({
        ...prev,
        x_client_id: "",
        x_client_secret: "",
        x_bearer_token: "",
        openai_api_key: "",
        x_redirect_uri: updated.x_redirect_uri,
        keyword_exact_match: updated.keyword_exact_match,
        min_like_count: updated.min_like_count,
        min_reply_count: updated.min_reply_count,
        min_repost_count: updated.min_repost_count,
        enable_topic_search: updated.enable_topic_search,
        enable_mentions: updated.enable_mentions,
        mentions_max_results: updated.mentions_max_results,
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
      const res = await fetch("/api/settings/test-x", {
        method: "POST",
        headers: { "x-account-id": settings?.account_id || "company" },
      });
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

  async function createAppUser() {
    setBusy("create-user");
    setError(null);
    try {
      await api("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      setNewUser({ email: "", password: "", role: "posting" });
      await loadAll();
      flash("User created");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setBusy(null);
    }
  }

  async function patchAppUser(
    id: string,
    patch: { active?: boolean; role?: "admin" | "posting" },
  ) {
    setBusy(`user-${id}`);
    setError(null);
    try {
      await api("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      await loadAll();
      flash("User updated");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user");
    } finally {
      setBusy(null);
    }
  }

  const isAdmin = sessionUser?.role === "admin";
  const activeTab = !isAdmin && tab === "settings" ? "compose" : tab;

  function connectX() {
    window.location.href = `/api/auth/x/start?account=${settings?.account_id || "company"}`;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-7xl fade-in">
        <header
          className="flex flex-wrap items-end justify-between gap-4 mb-8 pb-6 border-b"
          style={{ borderColor: "var(--brand)" }}
        >
          <div>
            <h1 className="flex flex-wrap items-center gap-2.5">
              <Image
                src="/monfort-logo.svg"
                alt="Monfort"
                width={741}
                height={166}
                priority
                className="h-8 md:h-[38px] w-auto"
              />
              <span className="text-[19px] md:text-2xl">Social</span>
              {settings ? (
                <span
                  aria-label="Current profile"
                  className="ml-1 border-l pl-3 text-sm md:text-base font-medium normal-case tracking-normal"
                  style={{
                    borderColor: "var(--border-strong)",
                    color: "var(--text)",
                  }}
                >
                  {settings.account_id === "personal"
                    ? "Personal"
                    : "Monfort Companies"}
                </span>
              ) : null}
            </h1>
            <p className="tagline mt-3 text-base md:text-lg md:whitespace-nowrap">
              Write and schedule posts, quote what you&apos;re reading, and
              answer people who mention you.
            </p>
          </div>
          <ProfileMenu
            user={sessionUser}
            handle={settings?.x_connected_handle || settings?.own_handle || ""}
            account={settings?.account_id || "company"}
            busy={Boolean(busy)}
            publishingPaused={settings?.publishing_paused ?? false}
            automationPaused={settings?.automation_paused ?? false}
            onSwitchAccount={(account) => {
              if (
                (content || notes || mediaPaths.length) &&
                !window.confirm(
                  "Switch accounts and discard unsaved composer changes?",
                )
              )
                return;
              window.location.assign(`/?account=${account}`);
            }}
            settingsActive={activeTab === "settings"}
            onSettings={isAdmin ? () => setTab("settings") : null}
            onSignOut={logout}
          />
        </header>

        <nav className="flex flex-wrap gap-2 mb-6">
          {(
            [
              ["compose", "Compose"],
              ["mentions", "Mentions"],
              ["feed", "Feed"],
              ["queue", "Queue"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn"
              onClick={() => {
                setTab(id);
                if (id === "compose") setComposerMode("original");
                // Feed and Mentions start in reply mode, not the Compose tab's "original".
                if (id === "feed" || id === "mentions")
                  setComposerMode("reply");
              }}
              style={
                activeTab === id
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

        {activeTab === "feed" && (
          <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="panel p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg">Last 24 hours</h2>
                  <p className="muted text-sm">
                    {settings?.topic_keywords?.length ||
                    (settings &&
                      (settings.min_like_count > 0 ||
                        settings.min_reply_count > 0 ||
                        settings.min_repost_count > 0))
                      ? [
                          settings.topic_keywords.length
                            ? `${settings.topic_keywords.length} keyword${settings.topic_keywords.length === 1 ? "" : "s"}${settings.keyword_exact_match ? " (exact)" : ""}`
                            : null,
                          settings.min_like_count > 0
                            ? `≥${settings.min_like_count} likes`
                            : null,
                          settings.min_reply_count > 0
                            ? `≥${settings.min_reply_count} replies`
                            : null,
                          settings.min_repost_count > 0
                            ? `≥${settings.min_repost_count} reposts`
                            : null,
                          settings.enable_topic_search
                            ? "topic search on"
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : "From your watched handles"}
                  </p>
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
                    No posts yet. Add handles or topic keywords in Settings,
                    then refresh.
                  </p>
                ) : (
                  posts.map((post) => (
                    <button
                      key={post.x_post_id}
                      type="button"
                      className="feed-item w-full text-left rounded-xl border p-4"
                      style={{ borderColor: "var(--border)" }}
                      data-active={target?.x_post_id === post.x_post_id}
                      onClick={() => selectTarget(post, "feed")}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-2">
                        <span
                          style={{ fontFamily: "var(--font-ibm), monospace" }}
                          className="text-sm"
                        >
                          @{post.author_handle}
                        </span>
                        <span className="muted text-xs">
                          {formatWhen(post.posted_at)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {post.content}
                      </p>
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
              target={target?.source === "feed" ? target : null}
              content={content}
              setContent={setContent}
              notes={notes}
              setNotes={setNotes}
              mediaPaths={mediaPaths}
              setMediaPaths={setMediaPaths}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              charClass={charClass}
              charCount={charCount}
              busy={busy}
              onGenerate={generate}
              onUpload={uploadMedia}
              canPublish={isAdmin}
              publishingPaused={settings?.publishing_paused ?? false}
              onAct={saveAndAct}
              onOpenInX={openReplyInX}
            />
          </section>
        )}

        {activeTab === "mentions" && (
          <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4">
            <div className="panel p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg">Mentions</h2>
                  <p className="muted text-sm">
                    {settings?.enable_mentions === false
                      ? "Mentions inbox is off in Settings"
                      : "Posts that @mention you, the only posts X lets this app reply to"}
                  </p>
                </div>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={refreshMentions}
                  disabled={
                    busy === "refresh-mentions" ||
                    settings?.enable_mentions === false
                  }
                >
                  {busy === "refresh-mentions" ? "Fetching…" : "Check mentions"}
                </button>
              </div>

              <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                {mentions.length === 0 ? (
                  <p className="muted text-sm py-10 text-center">
                    No mentions yet. Connect X in Settings, then check mentions.
                  </p>
                ) : (
                  mentions.map((m) => (
                    <button
                      key={m.x_post_id}
                      type="button"
                      className="feed-item w-full text-left rounded-xl border p-4"
                      style={{ borderColor: "var(--border)" }}
                      data-active={target?.x_post_id === m.x_post_id}
                      onClick={() => selectTarget(m, "mention")}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-2">
                        <span
                          style={{ fontFamily: "var(--font-ibm), monospace" }}
                          className="text-sm"
                        >
                          @{m.author_handle}
                        </span>
                        <span className="muted text-xs">
                          {m.replied_x_post_id ? "replied · " : ""}
                          {formatWhen(m.posted_at)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {m.content}
                      </p>
                    </button>
                  ))
                )}
              </div>
            </div>

            <Composer
              mode={composerMode}
              setMode={setComposerMode}
              target={target?.source === "mention" ? target : null}
              content={content}
              setContent={setContent}
              notes={notes}
              setNotes={setNotes}
              mediaPaths={mediaPaths}
              setMediaPaths={setMediaPaths}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              charClass={charClass}
              charCount={charCount}
              busy={busy}
              onGenerate={generate}
              onUpload={uploadMedia}
              canPublish={isAdmin}
              publishingPaused={settings?.publishing_paused ?? false}
              onAct={saveAndAct}
              onOpenInX={openReplyInX}
            />
          </section>
        )}

        {activeTab === "compose" && (
          <section className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 items-start">
            <Composer
              mode="original"
              setMode={() => setComposerMode("original")}
              target={null}
              forceOriginal
              content={content}
              setContent={setContent}
              notes={notes}
              setNotes={setNotes}
              mediaPaths={mediaPaths}
              setMediaPaths={setMediaPaths}
              scheduleAt={scheduleAt}
              setScheduleAt={setScheduleAt}
              charClass={charClass}
              charCount={charCount}
              busy={busy}
              onGenerate={generate}
              onUpload={uploadMedia}
              canPublish={isAdmin}
              publishingPaused={settings?.publishing_paused ?? false}
              onAct={saveAndAct}
              onOpenInX={openReplyInX}
            />
            <SchedulePanel
              drafts={drafts}
              busy={busy}
              canPublish={isAdmin && !settings?.publishing_paused}
              onAction={draftAction}
              onViewQueue={() => setTab("queue")}
            />
          </section>
        )}

        {activeTab === "queue" && (
          <section className="panel p-4 md:p-5">
            <h2 className="text-lg mb-1">Queue</h2>
            <p className="muted text-sm mb-3">
              Drafts, approvals, schedules, and recent failures for{" "}
              {settings?.account_id === "personal"
                ? "Personal"
                : "Monfort Companies"}
              .
            </p>
            <label className="flex gap-2 mb-5 text-sm">
              <input
                type="checkbox"
                checked={approvalOnly}
                onChange={(e) => setApprovalOnly(e.target.checked)}
              />
              Awaiting approval only
            </label>
            <div className="space-y-3">
              {queue.length === 0 ? (
                <p className="muted text-sm py-8 text-center">
                  Nothing in the queue.
                </p>
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
                          {d.type === "reply"
                            ? `Reply to @${d.reply_to_handle}`
                            : d.type === "quote"
                              ? `Quote of @${d.reply_to_handle}`
                              : "Original"}
                        </span>
                      </div>
                      <span className="muted text-xs">
                        {d.scheduled_at
                          ? `Scheduled ${formatWhen(d.scheduled_at)}`
                          : formatWhen(d.updated_at)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap mb-3">
                      {d.content}
                    </p>
                    {d.error ? (
                      <p
                        className="text-xs mb-3"
                        style={{ color: "var(--danger)" }}
                      >
                        {d.error}
                      </p>
                    ) : null}
                    {!["posting", "uncertain", "posted"].includes(d.status) ? (
                      <QueueEditor
                        draft={d}
                        busy={Boolean(busy)}
                        onSave={async (text, date) => {
                          setBusy(`draft-${d.id}`);
                          setError(null);
                          try {
                            await api("/api/drafts", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                id: d.id,
                                action: "update",
                                content: text,
                                scheduled_at: date
                                  ? fromLocalInputValue(date)
                                  : null,
                              }),
                            });
                            await loadAll();
                            flash("Draft updated");
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Update failed",
                            );
                          } finally {
                            setBusy(null);
                          }
                        }}
                      />
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      {d.status === "pending_approval" && isAdmin ? (
                        <button
                          className="btn btn-primary"
                          disabled={Boolean(busy)}
                          onClick={() => draftAction(d.id, "approve")}
                        >
                          Approve{d.scheduled_at ? " schedule" : " draft"}
                        </button>
                      ) : null}
                      {d.status === "draft" || d.status === "failed" ? (
                        <button
                          className="btn btn-ghost"
                          disabled={Boolean(busy)}
                          onClick={() => draftAction(d.id, "submit")}
                        >
                          Submit for approval
                        </button>
                      ) : null}
                      {isAdmin &&
                      !settings?.publishing_paused &&
                      ["draft", "scheduled", "failed"].includes(d.status) ? (
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
                        disabled={
                          Boolean(busy) ||
                          d.status === "posting" ||
                          d.status === "uncertain"
                        }
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

        {activeTab === "settings" && settings && isAdmin && (
          <section className="panel p-4 md:p-6 max-w-3xl space-y-6">
            <div>
              <h2 className="text-lg">Settings</h2>
              <p className="muted text-sm">
                Keys are stored in MongoDB. Leave blank to keep existing.
              </p>
            </div>

            <div
              className="flex flex-wrap gap-1 border-b pb-3"
              style={{ borderColor: "var(--border)" }}
            >
              {SETTINGS_TABS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className="btn"
                  onClick={() => setSettingsTab(id)}
                  style={
                    settingsTab === id
                      ? {
                          background: "var(--accent)",
                          color: "var(--accent-ink)",
                          padding: "0.35rem 0.8rem",
                        }
                      : {
                          border: "1px solid var(--border-strong)",
                          padding: "0.35rem 0.8rem",
                        }
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {settingsTab === "controls" && (
              <div className="space-y-4">
                <h3 className="text-sm">
                  Controls for{" "}
                  {settings.account_id === "personal"
                    ? "Personal"
                    : "Monfort Companies"}
                </h3>
                {(
                  [
                    [
                      "publishing_paused",
                      "Publishing",
                      "Stops Post now and scheduled publishing. Feed, mentions, AI drafting, editing, and approvals remain available.",
                    ],
                    [
                      "automation_paused",
                      "Background automation",
                      "Stops background feed and mentions checks and scheduled publishing. Manual posting remains available unless publishing is also paused.",
                    ],
                  ] as const
                ).map(([key, label, description]) => (
                  <div
                    key={key}
                    className="rounded-lg border p-4 space-y-3"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm">{label}</h4>
                      <span className="text-xs muted">
                        {settings[key] ? "Paused" : "Active"}
                      </span>
                    </div>
                    <p className="text-sm muted">{description}</p>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        setBusy("pause");
                        setError(null);
                        try {
                          await api("/api/settings", {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ [key]: !settings[key] }),
                          });
                          await loadAll();
                          flash(
                            `${label} ${settings[key] ? "resumed" : "paused"}`,
                          );
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Could not change pause setting",
                          );
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      {settings[key] ? "Resume" : "Pause"}{" "}
                      {key === "publishing_paused"
                        ? "publishing"
                        : "automation"}
                    </button>
                  </div>
                ))}
                <p className="muted text-xs">
                  Changes take effect immediately for this account. Resuming can
                  publish overdue approved schedules on the next background run.
                  Posts already sent to X cannot be recalled.
                </p>
              </div>
            )}

            {settingsTab === "editorial" && (
              <div className="space-y-4">
                <h3 className="text-sm">
                  Editorial rules for{" "}
                  {settings.account_id === "personal"
                    ? "Personal"
                    : "Monfort Companies"}
                </h3>
                <p className="muted text-sm">
                  Applied to every AI draft. Sources guide your editorial
                  choices; the app does not fetch articles from these
                  publications. Review every draft for accuracy and fit.
                </p>
                {(
                  [
                    ["editorial_topics", "Topics"],
                    ["editorial_sources", "Preferred sources"],
                    ["editorial_style", "Style"],
                    ["editorial_avoid", "Avoid"],
                  ] as const
                ).map(([key, label]) => (
                  <label className="block space-y-2" key={key}>
                    <span className="text-sm">{label}</span>
                    <textarea
                      className="field min-h-24"
                      value={settingsForm[key]}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          [key]: e.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            {settingsTab === "x" && (
              <div className="space-y-6">
                <label className="space-y-1.5 block">
                  <span className="text-sm muted">Your handle</span>
                  <input
                    className="field"
                    value={settingsForm.own_handle}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        own_handle: e.target.value,
                      })
                    }
                    placeholder="yourhandle"
                  />
                </label>

                <div>
                  <p className="text-sm muted mb-3">
                    X OAuth 2.0 — save Client ID / Secret, set the callback in X
                    console, then Connect
                  </p>
                  <div className="grid md:grid-cols-2 gap-4">
                    {(
                      [
                        ["x_client_id", "Client ID", settings.has_x_client_id],
                        [
                          "x_client_secret",
                          "Client Secret",
                          settings.has_x_client_secret,
                        ],
                        [
                          "x_bearer_token",
                          "Bearer Token (read feed)",
                          settings.has_x_bearer_token,
                        ],
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
                          onChange={(e) =>
                            setSettingsForm({
                              ...settingsForm,
                              [key]: e.target.value,
                            })
                          }
                          placeholder={has ? "••••••••" : ""}
                        />
                      </label>
                    ))}
                  </div>
                  <label className="space-y-1.5 block mt-4">
                    <span className="text-sm muted">
                      OAuth callback URL (must match X console exactly)
                    </span>
                    <input
                      className="field"
                      value={settingsForm.x_redirect_uri}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          x_redirect_uri: e.target.value,
                        })
                      }
                      placeholder="http://127.0.0.1:3000/api/auth/x/callback"
                    />
                  </label>
                  <p className="text-xs muted mt-2">
                    In X User authentication settings use type Web App, callback{" "}
                    <span style={{ fontFamily: "var(--font-ibm), monospace" }}>
                      {settingsForm.x_redirect_uri ||
                        "http://127.0.0.1:3000/api/auth/x/callback"}
                    </span>
                    . Prefer <code>127.0.0.1</code> over localhost.
                  </p>
                  <p className="text-sm mt-3">
                    {settings.has_x_user_token ? (
                      <span style={{ color: "var(--ok)" }}>
                        Connected
                        {settings.x_connected_handle
                          ? ` as @${settings.x_connected_handle}`
                          : ""}
                      </span>
                    ) : (
                      <span className="muted">
                        Not connected — posting requires Connect with X
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={connectX}
                    disabled={
                      !settings.has_x_client_id || !settings.has_x_client_secret
                    }
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
              </div>
            )}
            {settingsTab === "ai" && (
              <div className="space-y-6">
                <label className="space-y-1.5 block">
                  <span className="text-sm muted">
                    OpenAI API Key{" "}
                    {settings.has_openai_api_key ? "· saved" : ""}
                  </span>
                  <input
                    className="field"
                    type="password"
                    autoComplete="off"
                    value={settingsForm.openai_api_key}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        openai_api_key: e.target.value,
                      })
                    }
                    placeholder={settings.has_openai_api_key ? "••••••••" : ""}
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-sm muted">OpenAI model</span>
                  <input
                    className="field"
                    value={settingsForm.openai_model}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        openai_model: e.target.value,
                      })
                    }
                    placeholder="gpt-4o-mini"
                  />
                </label>

                <label className="space-y-1.5 block">
                  <span className="text-sm muted">
                    Reply system prompt (optional, mentions replies)
                  </span>
                  <textarea
                    className="field min-h-24"
                    value={settingsForm.reply_system_prompt}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        reply_system_prompt: e.target.value,
                      })
                    }
                  />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-sm muted">
                    Compose system prompt (optional, original and quote posts)
                  </span>
                  <textarea
                    className="field min-h-24"
                    value={settingsForm.compose_system_prompt}
                    onChange={(e) =>
                      setSettingsForm({
                        ...settingsForm,
                        compose_system_prompt: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
            )}
            {settingsTab === "feed" && (
              <div className="space-y-6">
                <label className="space-y-1.5 block">
                  <span className="text-sm muted">
                    Watched handles (one per line)
                  </span>
                  <textarea
                    className="field min-h-28"
                    value={handlesText}
                    onChange={(e) => setHandlesText(e.target.value)}
                    placeholder={"@elonmusk\n@openai"}
                  />
                </label>

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm">Feed filters</h3>
                    <p className="muted text-sm mt-1">
                      Keywords and engagement filters control which fetched
                      posts appear in your feed. X charges for returned posts
                      even when a local filter hides them. Topic search adds a
                      paid recent-search request using your keywords.
                    </p>
                  </div>

                  <label className="space-y-1.5 block">
                    <span className="text-sm muted">
                      Topic keywords (one phrase per line)
                    </span>
                    <textarea
                      className="field min-h-24"
                      value={keywordsText}
                      onChange={(e) => setKeywordsText(e.target.value)}
                      placeholder={"AI agents\nopen source LLM"}
                    />
                  </label>

                  <div className="flex flex-col gap-3">
                    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={settingsForm.keyword_exact_match}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            keyword_exact_match: e.target.checked,
                          })
                        }
                      />
                      <span>
                        Exact phrase match
                        <span className="muted block text-xs mt-0.5">
                          On: post must contain the full phrase. Off: every word
                          in the phrase may appear in any order.
                        </span>
                      </span>
                    </label>
                    <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={settingsForm.enable_topic_search}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            enable_topic_search: e.target.checked,
                          })
                        }
                      />
                      <span>
                        Also search X for these topics
                        <span className="muted block text-xs mt-0.5">
                          Uses recent search with quoted keywords; engagement
                          filters run locally. Requires keywords above. Works
                          with or without watched handles. Results are for
                          reading, quoting, or replying manually in X; X does
                          not allow automated replies to search results.
                        </span>
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Min likes</span>
                      <input
                        className="field"
                        type="number"
                        min={0}
                        value={settingsForm.min_like_count}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            min_like_count: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Min replies</span>
                      <input
                        className="field"
                        type="number"
                        min={0}
                        value={settingsForm.min_reply_count}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            min_reply_count: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Min reposts</span>
                      <input
                        className="field"
                        type="number"
                        min={0}
                        value={settingsForm.min_repost_count}
                        onChange={(e) =>
                          setSettingsForm({
                            ...settingsForm,
                            min_repost_count: Math.max(
                              0,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
            )}
            {settingsTab === "mentions" && (
              <div className="space-y-6">
                <p className="muted text-sm">
                  Mentions are the only posts X lets this app reply to through
                  the API.
                </p>
                <div className="flex flex-col gap-3">
                  <label className="flex items-start gap-2.5 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={settingsForm.enable_mentions}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          enable_mentions: e.target.checked,
                        })
                      }
                    />
                    <span>
                      Mentions inbox
                      <span className="muted block text-xs mt-0.5">
                        Fetches new posts that @mention you on each refresh and
                        cron run. Billed as owned reads (about $0.001 each) only
                        when this X user also owns the developer app. Other
                        accounts use standard read pricing. Each check fetches
                        one page and continues any backlog on the next check.
                      </span>
                    </span>
                  </label>
                  <label className="space-y-1.5 block max-w-48">
                    <span className="text-sm muted">
                      Max mentions per fetch
                    </span>
                    <input
                      className="field"
                      type="number"
                      min={5}
                      max={100}
                      value={settingsForm.mentions_max_results}
                      onChange={(e) =>
                        setSettingsForm({
                          ...settingsForm,
                          mentions_max_results: Math.min(
                            100,
                            Math.max(5, Number(e.target.value) || 5),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            )}
            {settingsTab === "users" && (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm">Users</h3>
                    <p className="muted text-sm mt-1">
                      Admin-only. Create posting users who can use Compose /
                      Mentions / Feed / Queue on the shared X workspace. They
                      cannot change settings or manage users.
                    </p>
                  </div>

                  <div className="grid md:grid-cols-[1.2fr_1fr_auto_auto] gap-3 items-end">
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Email</span>
                      <input
                        className="field"
                        type="email"
                        value={newUser.email}
                        onChange={(e) =>
                          setNewUser({ ...newUser, email: e.target.value })
                        }
                        placeholder="teammate@example.com"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Password</span>
                      <input
                        className="field"
                        type="password"
                        value={newUser.password}
                        onChange={(e) =>
                          setNewUser({ ...newUser, password: e.target.value })
                        }
                        placeholder="8+ characters"
                      />
                    </label>
                    <label className="space-y-1.5 block">
                      <span className="text-sm muted">Role</span>
                      <select
                        className="field"
                        value={newUser.role}
                        onChange={(e) =>
                          setNewUser({
                            ...newUser,
                            role: e.target.value as "admin" | "posting",
                          })
                        }
                      >
                        <option value="posting">posting</option>
                        <option value="admin">admin</option>
                      </select>
                    </label>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={createAppUser}
                      disabled={
                        busy === "create-user" ||
                        !newUser.email ||
                        newUser.password.length < 8
                      }
                    >
                      {busy === "create-user" ? "Creating…" : "Add user"}
                    </button>
                  </div>

                  <div className="space-y-2">
                    {users.length === 0 ? (
                      <p className="muted text-sm">No users loaded.</p>
                    ) : (
                      users.map((u) => (
                        <div
                          key={u.id}
                          className="flex flex-wrap items-center justify-between gap-3 py-2 border-b"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <div>
                            <p className="text-sm">{u.email}</p>
                            <p className="muted text-xs">
                              {u.role}
                              {u.active ? "" : " · inactive"}
                              {u.id === sessionUser?.id ? " · you" : ""}
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              className="btn btn-ghost text-sm"
                              type="button"
                              disabled={busy === `user-${u.id}`}
                              onClick={() =>
                                patchAppUser(u.id, {
                                  role:
                                    u.role === "admin" ? "posting" : "admin",
                                })
                              }
                            >
                              Make {u.role === "admin" ? "posting" : "admin"}
                            </button>
                            <button
                              className="btn btn-ghost text-sm"
                              type="button"
                              disabled={busy === `user-${u.id}`}
                              onClick={() =>
                                patchAppUser(u.id, { active: !u.active })
                              }
                            >
                              {u.active ? "Deactivate" : "Activate"}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {settingsTab !== "users" && settingsTab !== "controls" ? (
              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={saveSettings}
                  disabled={busy === "settings"}
                >
                  {busy === "settings" ? "Saving…" : "Save settings"}
                </button>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  // Past due but not posted yet (cron hasn't run, or it failed to claim it).
  if (d.getTime() < Date.now()) return "Overdue";
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(d) - startOf(new Date())) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Compose tab sidebar: what's already scheduled (soonest first) and recent drafts. */
function SchedulePanel(props: {
  drafts: Draft[];
  busy: string | null;
  canPublish: boolean;
  onAction: (id: string, action: "post" | "delete") => void;
  onViewQueue: () => void;
}) {
  const scheduled = props.drafts
    .filter((d) => d.status === "scheduled" && d.scheduled_at)
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!));
  const recentDrafts = props.drafts
    .filter((d) => d.status === "draft")
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 5);

  const groups: { label: string; items: Draft[] }[] = [];
  for (const d of scheduled) {
    const label = dayLabel(d.scheduled_at!);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(d);
    else groups.push({ label, items: [d] });
  }

  const typeLabel = (d: Draft) =>
    d.type === "reply"
      ? `Reply to @${d.reply_to_handle}`
      : d.type === "quote"
        ? `Quote of @${d.reply_to_handle}`
        : "Post";

  const row = (d: Draft, when: string) => (
    <div
      key={d.id}
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1.5 text-xs">
        <span style={{ fontFamily: "var(--font-ibm), monospace" }}>{when}</span>
        <span className="muted">
          {typeLabel(d)}
          {d.media_paths.length ? ` · ${d.media_paths.length} media` : ""}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap line-clamp-3 mb-2.5">
        {d.content}
      </p>
      <div className="flex gap-2">
        <button
          className="btn btn-ghost"
          type="button"
          style={{ padding: "0.25rem 0.7rem" }}
          disabled={Boolean(props.busy) || !props.canPublish}
          onClick={() => props.onAction(d.id, "post")}
        >
          Post now
        </button>
        <button
          className="btn btn-danger"
          type="button"
          style={{ padding: "0.25rem 0.7rem" }}
          disabled={props.busy === `draft-${d.id}`}
          onClick={() => props.onAction(d.id, "delete")}
        >
          Delete
        </button>
      </div>
    </div>
  );

  return (
    <div className="panel p-4 md:p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg">Scheduled</h2>
          <p className="muted text-sm">
            {scheduled.length
              ? `${scheduled.length} post${scheduled.length === 1 ? "" : "s"} queued`
              : "Nothing scheduled yet"}
          </p>
        </div>
        <button
          className="btn btn-ghost"
          type="button"
          onClick={props.onViewQueue}
        >
          View queue
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="muted text-sm py-6 text-center">
          Pick a time and hit Schedule. Upcoming posts will show here.
        </p>
      ) : (
        <div className="space-y-4 max-h-[60vh] overflow-auto pr-1">
          {groups.map((g) => (
            <div key={g.label} className="space-y-2">
              <p
                className="text-xs uppercase tracking-wide"
                style={{
                  color:
                    g.label === "Overdue" ? "var(--danger)" : "var(--muted)",
                }}
              >
                {g.label}
              </p>
              {g.items.map((d) =>
                row(
                  d,
                  new Date(d.scheduled_at!).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                ),
              )}
            </div>
          ))}
        </div>
      )}

      {recentDrafts.length ? (
        <div className="space-y-2 pt-1">
          <p className="text-xs uppercase tracking-wide muted">Recent drafts</p>
          {recentDrafts.map((d) => row(d, formatWhen(d.updated_at)))}
        </div>
      ) : null}
    </div>
  );
}

function ProfileMenu(props: {
  account: "company" | "personal";
  busy: boolean;
  publishingPaused: boolean;
  automationPaused: boolean;
  onSwitchAccount: (account: "company" | "personal") => void;
  user: SessionUser | null;
  handle: string;
  settingsActive: boolean;
  /** null for non-admins, who can't open Settings. */
  onSettings: (() => void) | null;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--bg-soft)]";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="block rounded-full overflow-hidden border-2"
        style={{
          borderColor:
            open || props.settingsActive
              ? "var(--accent)"
              : "var(--border-strong)",
        }}
      >
        <Image
          src="/avatar.jpg"
          alt="Profile"
          width={44}
          height={44}
          priority
        />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl border overflow-hidden z-20 shadow-2xl"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border-strong)",
          }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <p className="text-sm truncate">
              {props.user?.email ?? "Signed in"}
            </p>
            <p className="text-sm mt-1">
              {props.account === "personal" ? "Personal" : "Monfort Companies"}
            </p>
            {props.publishingPaused ? (
              <p className="muted text-xs mt-1">Publishing paused</p>
            ) : null}
            {props.automationPaused ? (
              <p className="muted text-xs mt-1">Background automation paused</p>
            ) : null}
            <p className="muted text-xs mt-0.5">
              {props.user?.role ?? ""}
              {props.handle ? (
                <>
                  {" · "}
                  <span style={{ fontFamily: "var(--font-ibm), monospace" }}>
                    @{props.handle}
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            aria-expanded={switching}
            disabled={props.busy}
            onClick={() => setSwitching((value) => !value)}
          >
            Switch account{" "}
            <span aria-hidden="true" className="float-right">
              {switching ? "−" : "+"}
            </span>
          </button>
          {switching ? (
            <div
              role="group"
              aria-label="Switch account"
              className="border-y py-1"
              style={{ borderColor: "var(--border)" }}
            >
              {(
                [
                  ["company", "Monfort Companies"],
                  ["personal", "Personal"],
                ] as const
              ).map(([account, label]) => (
                <button
                  key={account}
                  type="button"
                  role="menuitemradio"
                  aria-checked={props.account === account}
                  disabled={props.busy}
                  className={`${itemClass} pl-7`}
                  onClick={() => {
                    if (props.account === account) return;
                    props.onSwitchAccount(account);
                  }}
                >
                  {label}
                  {props.account === account ? (
                    <span aria-hidden="true" className="float-right">
                      ✓
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {props.onSettings ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                props.onSettings?.();
              }}
            >
              Settings
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            style={{ color: "var(--danger)" }}
            onClick={props.onSignOut}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Composer(props: {
  mode: ComposerMode;
  setMode: (m: ComposerMode) => void;
  target: Target | null;
  forceOriginal?: boolean;
  content: string;
  setContent: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
  mediaPaths: string[];
  setMediaPaths: (v: string[] | ((p: string[]) => string[])) => void;
  scheduleAt: string;
  setScheduleAt: (v: string) => void;
  charClass: string;
  charCount: number;
  busy: string | null;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  canPublish: boolean;
  publishingPaused: boolean;
  onAct: (action: "draft" | "schedule" | "post") => void;
  onOpenInX: () => void;
}) {
  useEffect(() => {
    if (props.forceOriginal) props.setMode("original");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.forceOriginal]);

  // X only accepts API replies to posts that mention us; other replies go through X's own UI.
  const replyInX = props.mode === "reply" && props.target?.source !== "mention";
  const hasLink = containsLink(props.content);

  return (
    <div className="panel p-4 md:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg">
          {props.forceOriginal ? "New post" : "Respond"}
        </h2>
        {!props.forceOriginal ? (
          <div className="flex gap-1">
            {(
              [
                ["reply", "Reply"],
                ["quote", "Quote"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="btn"
                onClick={() => props.setMode(id)}
                style={
                  props.mode === id
                    ? {
                        background: "var(--accent)",
                        color: "var(--accent-ink)",
                        padding: "0.35rem 0.8rem",
                      }
                    : {
                        border: "1px solid var(--border-strong)",
                        padding: "0.35rem 0.8rem",
                      }
                }
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!props.forceOriginal ? (
        <div
          className="rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--bg-soft)" }}
        >
          {props.target ? (
            <>
              <p className="muted text-xs mb-1">
                {props.mode === "quote" ? "Quoting" : "Replying to"} @
                {props.target.author_handle}
              </p>
              <p className="whitespace-pre-wrap line-clamp-4">
                {props.target.content}
              </p>
            </>
          ) : (
            <p className="muted">Select a post from the list.</p>
          )}
        </div>
      ) : null}

      {replyInX ? (
        <p className="text-xs muted">
          X only lets apps reply to posts that mention you, so this reply opens
          in X for you to post. Mentions can be replied to from the Mentions
          tab.
        </p>
      ) : null}

      <label className="block space-y-1.5">
        <span className="text-sm muted">Your notes for the AI</span>
        <textarea
          className="field min-h-24"
          value={props.notes}
          onChange={(e) => props.setNotes(e.target.value)}
          placeholder={
            props.mode === "original"
              ? "What should this post be about?"
              : "The point you want to make…"
          }
        />
        <span className="text-xs muted block">
          Only your notes are sent to the AI, never the post itself.
        </span>
      </label>

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
          <span className={`text-xs ${props.charClass}`}>
            {props.charCount}/280
          </span>
        </div>
        <textarea
          className="field min-h-36"
          value={props.content}
          onChange={(e) => props.setContent(e.target.value)}
          placeholder="Your reply or post…"
        />
        {hasLink && !replyInX ? (
          <span className="text-xs char-warn block">
            Contains a link: X bills posts with links at $0.20 instead of
            $0.015.
          </span>
        ) : null}
      </label>

      {replyInX ? (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            className="btn btn-primary"
            type="button"
            disabled={!props.target || !props.content.trim()}
            onClick={props.onOpenInX}
          >
            Open in X
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm muted">Media</span>
              <label
                className="btn btn-ghost"
                style={{ padding: "0.35rem 0.8rem" }}
              >
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
                  <li
                    key={p}
                    className="flex items-center justify-between text-xs muted gap-2"
                  >
                    <span
                      className="truncate"
                      style={{ fontFamily: "var(--font-ibm), monospace" }}
                    >
                      {p}
                    </span>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: "0.2rem 0.6rem" }}
                      onClick={() =>
                        props.setMediaPaths((prev) =>
                          prev.filter((x) => x !== p),
                        )
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs muted">
                Optional image or video attachment.
              </p>
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
              disabled={
                Boolean(props.busy) ||
                props.charCount > 280 ||
                (props.canPublish && props.publishingPaused)
              }
              onClick={() => props.onAct("post")}
            >
              {props.canPublish ? "Post now" : "Submit for approval"}
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              disabled={Boolean(props.busy)}
              onClick={() => props.onAct("schedule")}
            >
              {props.canPublish ? "Schedule" : "Submit schedule"}
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
        </>
      )}
    </div>
  );
}

function QueueEditor({
  draft,
  busy,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onSave: (text: string, date: string) => Promise<void>;
}) {
  const [text, setText] = useState(draft.content);
  const [date, setDate] = useState(
    draft.scheduled_at ? toLocalInputValue(draft.scheduled_at) : "",
  );
  return (
    <details className="mb-3">
      <summary className="text-sm cursor-pointer">
        Edit content or schedule
      </summary>
      <textarea
        aria-label="Draft text"
        className="field mt-2"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="text-xs muted">{xTextLength(text)}/280</span>
      <input
        aria-label="Draft schedule"
        className="field my-2"
        type="datetime-local"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      <p className="text-xs muted mb-2">
        Clear the date to keep an unscheduled draft.
      </p>
      <button
        className="btn btn-ghost"
        disabled={busy || Boolean(validateXText(text))}
        onClick={() => onSave(text, date)}
      >
        Save changes
      </button>
    </details>
  );
}
