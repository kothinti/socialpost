#!/usr/bin/env node
/**
 * Hit the app cron endpoint (daily fetch + due schedules).
 * Usage: CRON_SECRET=... APP_URL=http://localhost:3000 node scripts/run-cron.mjs
 */
const base = process.env.APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const res = await fetch(`${base}/api/cron?job=all`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
console.log(res.status, body);
if (!res.ok) process.exit(1);
