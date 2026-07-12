"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "setup" | "login">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Auth check failed");
        return r.json();
      })
      .then((data) => {
        if (data.authenticated) {
          window.location.replace("/");
          return;
        }
        setMode(data.needsSetup ? "setup" : "login");
      })
      .catch(() => setMode("login"))
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(mode === "setup" ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  if (mode === "loading") {
    return (
      <main className="min-h-screen grid place-items-center">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="panel w-full max-w-md p-8 fade-in">
        <p
          className="text-3xl tracking-tight mb-1"
          style={{ fontFamily: "var(--font-syne), sans-serif" }}
        >
          SocialPost
        </p>
        <p className="muted mb-8 text-sm">
          {mode === "setup"
            ? "Create the admin account to get started. Later users are added by an admin."
            : "Sign in to continue."}
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm muted">Email</span>
            <input
              className="field"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm muted">Password</span>
            <input
              className="field"
              type="password"
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          {error ? (
            <p className="text-sm" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}

          <button className="btn btn-primary w-full mt-2" disabled={busy} type="submit">
            {busy ? "Working…" : mode === "setup" ? "Create admin account" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
