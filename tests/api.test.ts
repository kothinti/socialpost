import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { MongoMemoryServer } from "mongodb-memory-server";

// Run after `npm run build`; the server uses only this ephemeral database.
test(
  "HTTP account selection, approval permissions, scheduling and cron",
  { timeout: 120000 },
  async (t) => {
    const mongo = await MongoMemoryServer.create();
    const port = 3127;
    const child = spawn(
      process.execPath,
      ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
      {
        env: {
          ...process.env,
          MONGODB_URI: mongo.getUri(),
          MONGODB_DB: "socialpost_http_test",
          AUTH_SECRET: "isolated-test-secret-12345678901234567890",
          CRON_SECRET: "test-cron-secret",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    t.after(async () => {
      child.kill("SIGTERM");
      if (child.exitCode === null) await once(child, "exit");
      await mongo.stop();
    });
    for (let i = 0; i < 200; i++) {
      if (output.includes("Ready in")) break;
      if (child.exitCode !== null) throw new Error(output);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.match(output, /Ready in/);
    const base = `http://127.0.0.1:${port}`;
    let admin = "";
    let posting = "";
    async function request(
      path: string,
      opts: {
        account?: string;
        cookie?: string;
        method?: string;
        body?: unknown;
        bearer?: string;
      } = {},
    ) {
      const res = await fetch(base + path, {
        method: opts.method || "GET",
        headers: {
          "content-type": "application/json",
          "x-account-id": opts.account || "company",
          cookie: opts.cookie ?? admin,
          ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        redirect: "manual",
      });
      return res;
    }
    const future = new Date(Date.now() + 3600000).toISOString();
    let personalDraft = "";

    await t.test(
      "one login accesses both profiles and secrets stay private",
      async () => {
        const setup = await request("/api/auth/setup", {
          method: "POST",
          body: { email: "admin@example.com", password: "test-password-123" },
        });
        assert.equal(setup.status, 200);
        admin = setup.headers.get("set-cookie")!.split(";")[0];
        const company = await (await request("/api/settings")).json();
        const personal = await (
          await request("/api/settings", { account: "personal" })
        ).json();
        assert.equal(company.account_id, "company");
        assert.equal(personal.account_id, "personal");
        assert.match(personal.editorial_topics, /stewardship/);
        assert.equal(personal.x_access_token, undefined);
        assert.equal(
          (await request("/api/settings", { account: "unknown" })).status,
          400,
        );
        assert.equal(
          (await request("/api/settings", { cookie: "" })).status,
          401,
        );
      },
    );
    await t.test(
      "draft and settings writes cannot cross accounts",
      async () => {
        const create = await request("/api/drafts", {
          account: "personal",
          method: "POST",
          body: {
            type: "original",
            content: "Personal insight",
            status: "pending_approval",
            scheduled_at: future,
          },
        });
        assert.equal(create.status, 200);
        personalDraft = (await create.json()).draft.id;
        assert.equal(
          (
            await request("/api/drafts", {
              method: "PATCH",
              body: { id: personalDraft, action: "delete" },
            })
          ).status,
          404,
        );
        assert.deepEqual(
          (await (await request("/api/drafts")).json()).drafts,
          [],
        );
        assert.equal(
          (
            await request("/api/settings", {
              account: "personal",
              method: "PUT",
              body: {
                publishing_paused: true,
                editorial_style: "Humble and thoughtful",
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (await (await request("/api/settings")).json()).publishing_paused,
          false,
        );
      },
    );
    await t.test(
      "posting users submit schedules and admins approve",
      async () => {
        assert.equal(
          (
            await request("/api/users", {
              method: "POST",
              body: {
                email: "writer@example.com",
                password: "writer-password-123",
                role: "posting",
              },
            })
          ).status,
          200,
        );
        const login = await request("/api/auth/login", {
          method: "POST",
          body: {
            email: "writer@example.com",
            password: "writer-password-123",
          },
        });
        posting = login.headers.get("set-cookie")!.split(";")[0];
        const create = await request("/api/drafts", {
          account: "personal",
          cookie: posting,
          method: "POST",
          body: {
            type: "original",
            content: "Writer insight",
            status: "scheduled",
            scheduled_at: future,
          },
        });
        const saved = (await create.json()).draft;
        assert.equal(saved.status, "pending_approval");
        for (const action of ["post", "approve"])
          assert.equal(
            (
              await request("/api/drafts", {
                account: "personal",
                cookie: posting,
                method: "PATCH",
                body: { id: saved.id, action },
              })
            ).status,
            403,
          );
        const approve = await request("/api/drafts", {
          account: "personal",
          method: "PATCH",
          body: { id: saved.id, action: "approve" },
        });
        assert.equal((await approve.json()).draft.status, "scheduled");
        assert.equal(
          (
            await request("/api/settings", {
              account: "personal",
              cookie: posting,
              method: "PUT",
              body: { publishing_paused: false },
            })
          ).status,
          403,
        );
        // Editing an approved schedule as a writer requires fresh approval.
        const edit = await request("/api/drafts", {
          account: "personal",
          cookie: posting,
          method: "PATCH",
          body: { id: saved.id, action: "update", content: "Changed insight" },
        });
        assert.equal((await edit.json()).draft.status, "pending_approval");
      },
    );
    await t.test(
      "limits, dates, reply restrictions and pauses fail before X calls",
      async () => {
        for (const account of ["company", "personal"]) {
          for (const body of [
            { type: "original", content: "界".repeat(141) },
            {
              type: "original",
              content: "Schedule",
              status: "scheduled",
              scheduled_at: "invalid",
            },
            { type: "reply", content: "Reply", reply_to_x_id: "not-a-mention" },
          ])
            assert.equal(
              (await request("/api/drafts", { account, method: "POST", body }))
                .status,
              400,
            );
        }
        assert.equal(
          (
            await request("/api/drafts", {
              account: "personal",
              method: "PATCH",
              body: { id: personalDraft, action: "approve" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/api/drafts", {
              account: "personal",
              method: "PATCH",
              body: { id: personalDraft, action: "post" },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await request("/api/compose", {
              method: "POST",
              body: {
                mode: "original",
                notes: "my notes",
                source_text: "X post content",
              },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "OAuth starts in the selected account and requires strict state",
      async () => {
        await request("/api/settings", {
          account: "personal",
          method: "PUT",
          body: { x_client_id: "test-client", x_client_secret: "test-secret" },
        });
        const start = await request("/api/auth/x/start?account=personal", {
          account: "personal",
        });
        assert.equal(start.status, 307);
        assert.match(
          start.headers.get("set-cookie")!,
          /x_oauth_account=personal/,
        );
        assert.match(start.headers.get("location")!, /oauth2/);
        const missingState = await request(
          "/api/auth/x/callback?code=fake-code",
          {
            cookie:
              admin +
              "; x_oauth_account=personal; x_oauth_verifier=fake-verifier; x_oauth_redirect=http://127.0.0.1/callback; x_oauth_state=expected",
          },
        );
        assert.equal(missingState.status, 307);
        assert.match(
          missingState.headers.get("location")!,
          /OAuth%20state%20mismatch/,
        );
      },
    );
    await t.test(
      "cron processes both accounts with secret auth and validates job",
      async () => {
        assert.equal(
          (await request("/api/cron?job=schedules", { cookie: "" })).status,
          401,
        );
        const cron = await request("/api/cron?job=schedules", {
          bearer: "test-cron-secret",
        });
        assert.deepEqual(await cron.json(), { company: [], personal: [] });
        assert.equal(
          (await request("/api/cron?job=typo", { bearer: "test-cron-secret" }))
            .status,
          400,
        );
      },
    );
  },
);
