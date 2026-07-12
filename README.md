# SocialPost

Personal one-pager for watching X handles, drafting AI replies/posts, and posting or scheduling to your own account.

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- SQLite (`data/socialpost.db`)
- X API (pay-per-usage) via `twitter-api-v2`
- OpenAI Chat Completions

## Setup

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create your solo account, then fill **Settings**:

| Field | Purpose |
| --- | --- |
| Client ID / Client Secret | X OAuth 2.0 app credentials |
| Bearer Token | Optional app-only token for reading timelines |
| Connect with X | OAuth 2.0 PKCE — required for posting |
| Callback URL | Must match X console (`http://127.0.0.1:3000/api/auth/x/callback`) |
| OpenAI API Key + model | Compose replies and original posts |
| Watched handles | Accounts to pull (last 24h), one per line |
| Your handle | Display only |

### X OAuth 2.0 setup

1. Developer Console → User authentication → **OAuth 2.0**
2. Type: **Web App**
3. Callback: `http://127.0.0.1:3000/api/auth/x/callback` (not `localhost`)
4. Website: `http://127.0.0.1:3000`
5. Open the app at **http://127.0.0.1:3000** (same host as the callback)
6. Paste Client ID + Client Secret in Settings → Save → **Connect with X**
7. Needed scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`, `media.write`

## Daily jobs

Scheduling is local: drafts are stored in SQLite and posted when due.

Run once a day (and optionally more often for schedules):

```bash
# every day at 9:00 — fetch last 24h + flush due schedules
0 9 * * * cd /path/to/astana && CRON_SECRET=... APP_URL=http://127.0.0.1:3000 npm run cron
```

Or while signed in, call `POST /api/cron` / use **Refresh now** on the Feed tab.

`CRON_SECRET` must match `.env.local` for unattended runs.

## App flow

1. **Feed** — posts from watched handles (24h). Select one to reply.
2. **Compose** — AI-assisted original posts to your handle; attach media (upload, no generation).
3. **Queue** — drafts, scheduled items, failures; post or delete.
4. **Settings** — keys, model, handles, optional system prompts.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production |
| `npm run cron` | Trigger fetch + schedule flush |

## Notes

- Solo login only (one account).
- Secrets are stored in SQLite on disk; keep `data/` private.
- Media uploads live in `data/uploads/` (max 15MB in-app).
