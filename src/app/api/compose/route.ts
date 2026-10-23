import { accountRoute } from "@/lib/accounts";
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { composeFromNotes } from "@/lib/openai";
import { z } from "zod";

// Only the user's own notes are accepted; post text from X is never sent to OpenAI.
const schema = z.object({
  mode: z.enum(["reply", "quote", "original"]),
  notes: z.string().trim().min(1),
}).strict();

async function handlePOST(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError("Add some notes for the AI first");

  try {
    const text = await composeFromNotes(body.data);
    return jsonOk({ text });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Compose failed", 500);
  }
}

export const POST = accountRoute(handlePOST);
