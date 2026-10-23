#!/usr/bin/env node
/**
 * Hit the app cron endpoint. Schedules by default; CRON_JOB=all for daily reads.
 * Usage: CRON_SECRET=... APP_URL=http://localhost:3000 node scripts/run-cron.mjs
 */
const base = process.env.APP_URL || "http://localhost:3000";
const secret = process.env.CRON_SECRET;

if (!secret) {
  console.error("CRON_SECRET is required");
  process.exit(1);
}

const job = process.env.CRON_JOB || "schedules";
if (!["all", "schedules", "fetch", "mentions"].includes(job))
  throw new Error("Invalid CRON_JOB");
const res = await fetch(`${base}/api/cron?job=${job}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
});

const body = await res.text();
console.log(res.status, body);
function hasError(value) {
  return (
    value &&
    typeof value === "object" &&
    (Boolean(value.error) ||
      value.ok === false ||
      Object.values(value).some(hasError))
  );
}
if (!res.ok || hasError(JSON.parse(body))) process.exit(1);
