import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError, jsonOk, unauthorized } from "@/lib/http";
import { composeOriginal, composeReply } from "@/lib/openai";
import { z } from "zod";

const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("reply"),
    postContent: z.string().min(1),
    authorHandle: z.string().min(1),
    instruction: z.string().optional(),
  }),
  z.object({
    mode: z.literal("original"),
    prompt: z.string().min(1),
  }),
]);

export async function POST(req: NextRequest) {
  if (!(await getSession())) return unauthorized();

  const body = schema.safeParse(await req.json());
  if (!body.success) return jsonError("Invalid compose request");

  try {
    if (body.data.mode === "reply") {
      const text = await composeReply(body.data);
      return jsonOk({ text });
    }
    const text = await composeOriginal({ prompt: body.data.prompt });
    return jsonOk({ text });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Compose failed", 500);
  }
}
