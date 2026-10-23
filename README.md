# MonfortSocial

Personal workspace for watching X handles / topics, drafting AI replies/posts, and posting or scheduling to a shared X account.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- MongoDB (`MONGODB_URI`)
- X API (pay-per-usage) via `twitter-api-v2`
- OpenAI Chat Completions

## Setup

```bash
cp .env.example .env.local
# set MONGODB_URI, AUTH_SECRET, CRON_SECRET
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first account becomes **admin**. Additional users are created by an admin (no public signup).

### Roles

| Role | Access |
| --- | --- |
| `admin` | Settings, X/OpenAI credentials, feed filters, user management, plus posting |
| `posting` | Feed, Compose, Queue only (shared workspace) |

Fill **Settings** (admin):

| Field | Purpose |
| --- | --- |
| Client ID / Client Secret | X OAuth 2.0 app credentials |
| Bearer Token | Optional app-only token for reading timelines |
| Connect with X | OAuth 2.0 PKCE — required for posting |
| Callback URL | Must match X console (`http://127.0.0.1:3000/api/auth/x/callback`) |
| OpenAI API Key + model | Compose replies and original posts |
| Watched handles | Accounts to pull (last 24h), one per line |
| Topic keywords | Exact-phrase (or loose) filters; optional X recent search |
| Min likes / replies / reposts | Drop low-engagement posts before they hit the feed |
| Users | Create admin or posting accounts |
| Your handle | Display only |

### X OAuth 2.0 setup

1. Developer Console → User authentication → **OAuth 2.0**
2. Type: **Web App**
3. App permissions: **Read and write** (needed for posting / media)
4. Callback URI(s) — add **exact** matches for every host you use:
   - Local: `http://127.0.0.1:3000/api/auth/x/callback`
   - Vercel: `https://YOUR-APP.vercel.app/api/auth/x/callback`
5. Website URL: same origin (e.g. `https://YOUR-APP.vercel.app`)
6. In MonfortSocial Settings: paste **Client ID** + **Client Secret** → Save
7. Open the app on that same host → **Connect with X**
8. Needed scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write`

If X shows “You weren’t able to give access to the App”, the callback URL in the X console does not exactly match the URL MonfortSocial is using (scheme + host + path).

## Daily jobs

Scheduling is local to MongoDB drafts and posted when due.

```bash
# every day at 9:00 — fetch last 24h + flush due schedules
0 9 * * * cd /path/to/astana && CRON_JOB=all CRON_SECRET=... APP_URL=http://127.0.0.1:3000 npm run cron
```

Or while signed in, call `POST /api/cron` / use **Refresh now** on the Feed tab.

`CRON_SECRET` must match `.env.local` for unattended runs.

## App flow

1. **Feed** — posts from watched handles and/or topic search (24h), filtered by keywords + engagement. Select one to reply.
2. **Compose** — AI-assisted original posts to your handle; attach media (upload, no generation).
3. **Queue** — drafts, scheduled items, failures; post or delete.
4. **Settings** (admin) — keys, model, handles, filters, users, optional system prompts.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production |
| `npm run cron` | Publish due approved schedules (both accounts) |

## X API rules this app follows

- **Replies:** since Feb 2026, X only accepts API replies to posts that @mention your account (or quote your post). The Mentions tab replies through the API, and the server checks that the post is a stored mention. Replies to any other post open X's own reply box (web intent) so you post them yourself.
- **Quotes and original posts** go through the API as before, with scheduling and media.
- **AI:** only your notes are sent to OpenAI, never the X post text (the X Developer Agreement restricts sharing X content with third parties). A person reviews every draft; nothing replies automatically.
- **Storage:** fetched feed posts are kept for 24 hours and mentions for 24 hours.
- **Cost:** pay-per-use posts cost $0.015, or $0.20 with a link (the composer warns you). Mentions use each account’s user token. The $0.001 owned-read rate applies only when the authenticated X user owns the developer app; the second account may incur standard read pricing. Confirm current rates in the X developer console.

## Notes

- Shared login with two isolated X profiles: Personal and Monfort Companies.
- Secrets live in MongoDB settings; keep your DB private.
- Media uploads are stored in MongoDB (GridFS bucket `media`, max 15MB) so they work on Vercel and survive restarts. Drafts created before this still read from `data/uploads/`. Note Vercel caps request bodies at 4.5MB, so larger files only upload on a VPS deploy.
- Switching from SQLite: start fresh with MongoDB (no automatic migration).

## Railway

1. New project → Deploy from GitHub repo. Railway detects Next.js and runs `npm run build` / `npm start` (the app listens on Railway's `PORT`).
2. Variables: `MONGODB_URI`, `AUTH_SECRET`, `CRON_SECRET` (long random strings for the secrets).
3. Settings → Networking → Generate Domain. In the X developer console set the callback to `https://<your-domain>/api/auth/x/callback`.
4. Cron: add a second service from the same repo with Start Command `npm run cron`, Cron Schedule `*/5 * * * *`, and variables `APP_URL=https://<your-domain>` and the same `CRON_SECRET`. It calls `/api/cron?job=schedules` for both accounts and exits. Add a daily service with `CRON_JOB=all` for feed and mentions reads; use `CRON_JOB=mentions` on a separate cadence if needed.
5. Redirects and the OAuth callback use the proxy's `X-Forwarded-Host` / `X-Forwarded-Proto`, so no extra URL config is needed.

## Vercel

1. **Framework Preset** must be **Next.js** (Settings → Build and Deployment). Leave **Output Directory** empty (do not set `.next`).
2. Set env vars: `MONGODB_URI`, `AUTH_SECRET`, `CRON_SECRET` (and optionally `APP_URL` to your `*.vercel.app` URL).
3. Use a MongoDB Atlas URI that allows Vercel IPs (`0.0.0.0/0` is simplest for serverless).
4. Redeploy after changing env or framework settings.
5. Cron: Vercel Cron calls `GET /api/cron` and sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET` is set. External callers can use `GET` or `POST` with the same header. Scheduled posts only go out when cron runs, so run it as often as your plan allows.
6. `AUTH_SECRET` is required in production; requests that need a session fail until it is set.

## Two X accounts

Profile menu → **Switch account** switches between **Monfort Companies** and **Personal** using the existing app login. Switching reloads the app and asks before discarding unsaved composer text. Users and roles are shared. Every X connection, AI key/model, editorial profile, feed, mentions cursor, media upload, queue, pause setting and job log belongs to the selected account. API clients select it with `x-account-id: company|personal` or `?account=...`; an omitted selector preserves the legacy company profile.

Existing `settings/app`, drafts, feed, mentions and GridFS media remain under Monfort Companies. Personal starts empty, with the requested editorial topics, sources, style and exclusions. Its data uses `personal_*` collections and `settings/personal`; no migration or external database changes are required. Connect a distinct X identity in each account’s Settings. Both may use the same developer app credentials and callback URL, but each requires its own OAuth authorization. Reconnecting a different identity into an existing profile is blocked to protect its queued posts. Configure OpenAI separately for each profile.

**Approvals:** posting users save drafts and submit content/schedules for approval. An admin approves a pending schedule before cron can publish it, or approves a draft before posting it. Admins may also post or schedule directly after reviewing their own work. Editing a scheduled item as a posting user returns it to approval. Queue includes an approval filter and inline content/schedule editing. Past schedules must be moved to a future time before approval.

**Settings → Controls** contains the per-account pause buttons; changes take effect immediately. **Pause publishing** blocks manual and scheduled publishing for that account. **Pause automation** blocks background reads and scheduled publishing; an admin can still post manually unless publishing is also paused. Work already sent to X cannot be recalled. Resuming processes overdue approved schedules on the next schedules run. Existing cron endpoints process both accounts and isolate account failures. Keep frequent jobs on `job=schedules` to avoid unnecessary paid reads.

All create, edit, schedule, AI and publish paths enforce the standard 280 **weighted** character limit using X’s `twitter-text` parser (URLs, Unicode and emoji included). Premium long posts are intentionally unsupported. AI uses only the supplied notes plus the selected editorial settings. Preferred sources are editorial guidance, not a news ingestion service. Topics/style/exclusions guide AI generation and require human review; they do not semantically filter manual writing or fetch articles from those publications.

Publishing uses atomic draft claims and persistent per-account content/reply claims. Exact duplicate content with the same type/target/media, or a second reply to the same mention, is blocked. Definitive X errors are shown as failed; no automatic retries occur. A network error or server error during a send is marked **uncertain** and held for manual verification on X. A crash may leave **posting**; neither status can be reposted or deleted through the app. If X succeeds but local persistence fails, the publication claim remains to prevent a duplicate. Verify X before asking an operator to reconcile these records. Token refresh and feed/mentions fetches use MongoDB leases to prevent overlapping work.

Mentions fetches process one configured page per run and persist pagination state before advancing the high-water mark, preventing a full page from skipping older mentions. Expired pagination tokens require another check after the cursor is reset. X still limits available history and endpoint access. Search uses supported text operators with a 512-character cap; engagement filters run locally. Four still images or a single video/GIF are supported; X can apply additional media, billing, rate and permission limits. General feed replies continue to open X for manual posting; API replies require a fresh mention belonging to the selected account. AI reply bots are not enabled.

References: [character counting](https://docs.x.com/fundamentals/counting-characters), [search query limits](https://docs.x.com/x-api/posts/search/integrate/build-a-query), [pricing and owned reads](https://docs.x.com/x-api/getting-started/pricing), [automation rules](https://help.x.com/en/rules-and-policies/x-automation).

### Verification

Run `npm run build`, then `npm test` and `npx tsc --noEmit`. Tests use disposable local MongoDB instances, mock X/OpenAI calls, and start a temporary production server on port 3127 for login, account isolation, permissions, approval, schedule, pause and cron checks. The first test run downloads a MongoDB test binary. No production database or real API credentials are used. These checks do not replace live OAuth authorization and one approved posting check on each real account after deployment.
