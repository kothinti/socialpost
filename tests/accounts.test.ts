import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import { TwitterApi, TwitterApiv2 } from "twitter-api-v2";
import { accountId, inAccount } from "../src/lib/accounts";
import * as db from "../src/lib/db";
import {
  canReplyViaApi,
  processDueSchedules,
  runDailyFetch,
} from "../src/lib/jobs";
import {
  fetchMentions,
  fetchWatchedPostsLast24h,
  verifyXWriteAuth,
} from "../src/lib/x";
import { composeFromNotes } from "../src/lib/openai";
import { validateXText, xTextLength } from "../src/lib/x-text";
import { buildTopicSearchQuery } from "../src/lib/feed-filters";

let mongo: MongoMemoryServer;
before(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "socialpost_accounts_test";
});
after(async () => {
  mock.restoreAll();
  await (
    globalThis as unknown as { __mongoClient?: { close(): Promise<void> } }
  ).__mongoClient?.close();
  await mongo?.stop();
});
const due = () => new Date(Date.now() - 1000).toISOString();
const draft = (content: string) =>
  db.createDraft({
    type: "original",
    content,
    status: "scheduled",
    scheduled_at: due(),
  });
const configure = () =>
  db.updateSettings({
    x_access_token: "test-token",
    x_connected_user_id: `test-${accountId()}`,
    x_connected_handle: "test",
    watched_handles: ["source"],
  });

test("weighted X limits handle boundaries, URLs, CJK, emoji and NFC", () => {
  assert.equal(validateXText("a".repeat(280)), null);
  assert.match(validateXText("a".repeat(281))!, /280/);
  assert.equal(xTextLength("https://example.com/" + "a".repeat(300)), 23);
  assert.equal(xTextLength("界".repeat(141)), 282);
  assert.equal(xTextLength("👨‍👩‍👧‍👦"), 2);
  assert.equal(xTextLength("e\u0301"), 1);
  assert.ok(validateXText("\uFFFE"));
});

test("account data and editorial defaults remain isolated, with shared users", async () => {
  const company = await inAccount("company", () => db.getSettings());
  const personal = await inAccount("personal", () => db.getSettings());
  assert.equal(company.editorial_topics, "");
  assert.match(personal.editorial_sources, /Colorado Sun.*McKinsey/);
  await inAccount("personal", () =>
    db.updateSettings({ own_handle: "private", editorial_style: "Measured" }),
  );
  assert.equal((await db.getSettings()).own_handle, "");
  const saved = await inAccount("personal", () => draft("Private queue"));
  assert.equal(await db.findDraftById(saved.id), null);
  assert.equal((await db.listDrafts()).length, 0);
  await inAccount("personal", () =>
    db.saveMedia("photo.jpg", Buffer.from("private"), "image/jpeg"),
  );
  assert.equal(await db.readMedia("photo.jpg"), null);
  assert.equal(
    (await inAccount("personal", () => db.readMedia("photo.jpg")))?.toString(),
    "private",
  );
  const mention = {
    x_post_id: "shared-post",
    author_handle: "reader",
    author_name: null,
    content: "hello",
    posted_at: new Date().toISOString(),
  };
  await inAccount("personal", () => db.upsertMention(mention));
  assert.equal(await canReplyViaApi("shared-post"), false);
  assert.equal(
    await inAccount("personal", () => canReplyViaApi("shared-post")),
    true,
  );
});

test("only one of twenty competing claims can publish a draft", async () => {
  const saved = await draft("Claim race");
  const claims = await Promise.all(
    Array.from({ length: 20 }, () =>
      db.claimDraftForPosting(saved.id, ["scheduled"]),
    ),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await db.deleteDraft(saved.id), false);
});

test("schedules, pause controls and duplicate protection work independently", async () => {
  await configure();
  await inAccount("personal", configure);
  const posted: string[] = [];
  const tweet = mock.method(
    TwitterApiv2.prototype,
    "tweet",
    async (payload: { text: string }) => {
      posted.push(payload.text);
      return { data: { id: String(posted.length) } };
    },
  );
  await db.updateSettings({ publishing_paused: true });
  await draft("Company scheduled");
  await inAccount("personal", () => draft("Personal scheduled"));
  assert.deepEqual(await processDueSchedules(), []);
  await inAccount("personal", processDueSchedules);
  assert.ok(posted.includes("Personal scheduled"));
  assert.ok(!posted.includes("Company scheduled"));
  await db.updateSettings({ publishing_paused: false });
  await Promise.all([processDueSchedules(), processDueSchedules()]);
  assert.equal(posted.filter((text) => text === "Company scheduled").length, 1);
  await draft("Company scheduled");
  const result = await processDueSchedules();
  assert.ok(result.some((r) => r.error?.includes("Duplicate")));
  tweet.mock.restore();
});

test("uncertain X delivery is held and cannot be claimed again", async () => {
  const tweet = mock.method(TwitterApiv2.prototype, "tweet", async () => {
    throw new Error("socket closed after write");
  });
  const saved = await draft("Uncertain delivery");
  await processDueSchedules();
  assert.equal((await db.findDraftById(saved.id))?.status, "uncertain");
  assert.equal(
    await db.claimDraftForPosting(saved.id, ["failed", "scheduled"]),
    null,
  );
  assert.equal(await db.deleteDraft(saved.id), false);
  tweet.mock.restore();
});

test("feed caches are account-specific and repeated reads upsert rather than duplicate", async () => {
  const user = mock.method(
    TwitterApiv2.prototype,
    "userByUsername",
    async () => ({
      data: { id: "source-id", username: "source", name: "Source" },
    }),
  );
  const timeline = mock.method(
    TwitterApiv2.prototype,
    "userTimeline",
    async () => ({
      includes: {},
      tweets: [
        {
          id: "feed-1",
          text: "Colorado investment",
          created_at: new Date().toISOString(),
        },
      ],
    }),
  );
  await db.updateSettings({ topic_keywords: [], enable_topic_search: false });
  await fetchWatchedPostsLast24h();
  await fetchWatchedPostsLast24h();
  assert.equal((await db.listFetchedPostsSince(24)).length, 1);
  assert.equal(
    (await inAccount("personal", () => db.listFetchedPostsSince(24))).length,
    0,
  );
  await db.updateSettings({ automation_paused: true });
  assert.deepEqual(await runDailyFetch(), { skipped: "automation paused" });
  user.mock.restore();
  timeline.mock.restore();
});

test("mentions paginate before committing a per-account cursor and deduplicate", async () => {
  let pageCount = 0;
  const timeline = mock.method(
    TwitterApiv2.prototype,
    "userMentionTimeline",
    async (_user: string, options: { pagination_token?: string }) => {
      pageCount++;
      const older = Boolean(options.pagination_token);
      return {
        includes: {},
        meta: {
          newest_id: older ? "101" : "102",
          ...(older ? {} : { next_token: "page-2" }),
        },
        tweets: [
          {
            id: older ? "101" : "102",
            text: "@test hello",
            created_at: new Date().toISOString(),
          },
        ],
      };
    },
  );
  await fetchMentions();
  assert.equal((await db.getSettings()).mentions_since_id, "");
  assert.equal((await db.getSettings()).mentions_next_token, "page-2");
  await fetchMentions();
  assert.equal(pageCount, 2);
  assert.equal((await db.listMentions()).length, 2);
  assert.equal((await db.getSettings()).mentions_since_id, "102");
  assert.equal(
    (await inAccount("personal", () => db.getSettings())).mentions_since_id,
    "",
  );
  timeline.mock.restore();
});

test("AI receives selected account editorial rules and only supplied notes", async () => {
  await inAccount("personal", () =>
    db.updateSettings({ openai_api_key: "fake-key" }),
  );
  let body = "";
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      body = String(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "Patient capital builds enduring businesses.",
              },
            },
          ],
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  const text = await inAccount("personal", () =>
    composeFromNotes({ mode: "original", notes: "Patient capital" }),
  );
  assert.match(text, /Patient capital/);
  assert.match(body, /Colorado Sun/);
  assert.match(body, /Measured/);
  assert.match(body, /No hashtags/);
  assert.ok(!body.includes("@test hello"));
  fetchMock.mock.restore();
});

test("leases prevent overlapping fetch/refresh and are scoped to the account", async () => {
  const token = await db.acquireAccountLease("check");
  assert.ok(token);
  assert.equal(await db.acquireAccountLease("check"), null);
  const personal = await inAccount("personal", () =>
    db.acquireAccountLease("check"),
  );
  assert.ok(personal);
  await db.releaseAccountLease("check", "wrong-token");
  assert.equal(await db.acquireAccountLease("check"), null);
  await db.releaseAccountLease("check", token!);
  assert.ok(await db.acquireAccountLease("check"));
});

test("recent search excludes unsupported operators and enforces query size", () => {
  const filters = {
    topic_keywords: ["Colorado business"],
    keyword_exact_match: true,
    min_like_count: 10,
    min_reply_count: 2,
    min_repost_count: 3,
    enable_topic_search: true,
  };
  assert.equal(
    buildTopicSearchQuery(filters),
    '"Colorado business" -is:retweet -is:reply',
  );
  assert.throws(
    () =>
      buildTopicSearchQuery({ ...filters, topic_keywords: ["a".repeat(513)] }),
    /512/,
  );
});

test("concurrent token refresh rotates only the selected account once", async () => {
  await db.updateSettings({
    x_api_key: "fake-client",
    x_api_secret: "fake-secret",
    x_access_token: "expired-company",
    x_access_secret: "old-refresh",
    x_oauth_expires_at: new Date(Date.now() - 1000).toISOString(),
  });
  const personalBefore = (await inAccount("personal", () => db.getSettings()))
    .x_access_token;
  let refreshCount = 0;
  const refresh = mock.method(
    TwitterApi.prototype,
    "refreshOAuth2Token",
    async () => {
      refreshCount++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        accessToken: "renewed-company",
        refreshToken: "new-refresh",
        expiresIn: 7200,
      };
    },
  );
  const me = mock.method(TwitterApiv2.prototype, "me", async () => ({
    data: { id: "test-company", username: "test" },
  }));
  const results = await Promise.all([verifyXWriteAuth(), verifyXWriteAuth()]);
  assert.ok(results.some((result) => result.ok));
  assert.equal(refreshCount, 1);
  const settings = await db.getSettings();
  assert.equal(settings.x_access_token, "renewed-company");
  assert.equal(settings.x_access_secret, "new-refresh");
  assert.equal(
    (await inAccount("personal", () => db.getSettings())).x_access_token,
    personalBefore,
  );
  refresh.mock.restore();
  me.mock.restore();
});
