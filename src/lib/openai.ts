import OpenAI from "openai";
import { getSettings } from "./db";

async function getClient() {
  const s = await getSettings();
  if (!s.openai_api_key) throw new Error("OpenAI API key is not configured");
  return {
    client: new OpenAI({ apiKey: s.openai_api_key }),
    model: s.openai_model || "gpt-4o-mini",
    settings: s,
  };
}

export async function composeReply(opts: {
  postContent: string;
  authorHandle: string;
  instruction?: string;
}) {
  const { client, model, settings } = await getClient();
  const system =
    settings.reply_system_prompt ||
    `You write concise, natural replies for X (Twitter). Stay under 280 characters unless asked otherwise. Match a thoughtful, human voice. No hashtags unless asked. Do not wrap the reply in quotes.`;

  const user = [
    `Compose a reply to @${opts.authorHandle}'s post.`,
    opts.instruction ? `Extra instruction: ${opts.instruction}` : null,
    "",
    "Post:",
    opts.postContent,
  ]
    .filter(Boolean)
    .join("\n");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
  });

  const text = completion.choices[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Model returned empty reply");
  return text;
}

export async function composeOriginal(opts: {
  prompt: string;
}) {
  const { client, model, settings } = await getClient();
  const system =
    settings.compose_system_prompt ||
    `You write original posts for X (Twitter). Default to under 280 characters unless the user asks for a thread or longer. Sound human and specific. Avoid corporate filler and unnecessary hashtags. Do not wrap the post in quotes.`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: opts.prompt },
    ],
    temperature: 0.85,
  });

  const text = completion.choices[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Model returned empty post");
  return text;
}
