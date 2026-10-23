import { AsyncLocalStorage } from "node:async_hooks";
import type { NextRequest } from "next/server";

export const ACCOUNT_IDS = ["company", "personal"] as const;
export type AccountId = (typeof ACCOUNT_IDS)[number];
const context = new AsyncLocalStorage<AccountId>();
export function accountId(): AccountId {
  return context.getStore() ?? "company";
}
export function inAccount<T>(account: AccountId, task: () => T): T {
  return context.run(account, task);
}
/** Preserve existing company collections; personal data has its own namespace. */
export function accountCollection(name: string) {
  return accountId() === "company" ? name : `personal_${name}`;
}
export function accountRoute(handler: (req: NextRequest) => Promise<Response>) {
  return async (req: NextRequest) => {
    const selected = req.nextUrl.pathname.endsWith("/auth/x/callback")
      ? req.cookies.get("x_oauth_account")?.value
      : (req.headers.get("x-account-id") ??
        req.nextUrl.searchParams.get("account") ??
        "company");
    if (selected !== "company" && selected !== "personal") {
      return Response.json({ error: "Invalid account" }, { status: 400 });
    }
    return inAccount(selected, () => handler(req));
  };
}
