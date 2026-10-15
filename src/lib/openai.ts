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

export type ComposeMode = "reply" | "quote" | "original";

const DEFAULT_PROMPTS: Record<ComposeMode, string> = {
  reply: `You write concise, natural replies for X (Twitter). Stay under 280 characters unless asked otherwise. Match a thoughtful, human voice. No hashtags unless asked. Do not wrap the reply in quotes.`,
  quote: `You write short commentary for an X (Twitter) quote post. Stay under 280 characters. Add a clear point of view rather than restating the quoted post. Sound human and specific. No hashtags unless asked. Do not wrap the post in quotes.`,
  original: `You write original posts for X (Twitter). Default to under 280 characters unless the user asks for a thread or longer. Sound human and specific. Avoid corporate filler and unnecessary hashtags. Do not wrap the post in quotes.`,
};

/**
 * Draft a post from the user's own notes. X content (the post being replied to
 * or quoted) is deliberately never sent to OpenAI: the X Developer Agreement
 * restricts redistributing X content to third parties.
 */
export async function composeFromNotes(opts: { mode: ComposeMode; notes: string }) {
  const { client, model, settings } = await getClient();
  const custom =
    opts.mode === "reply"
      ? settings.reply_system_prompt
      : settings.compose_system_prompt;
  const system = custom || DEFAULT_PROMPTS[opts.mode];

  const user =
    opts.mode === "original"
      ? opts.notes
      : `Write the ${opts.mode === "reply" ? "reply" : "quote-post commentary"} from these notes:\n\n${opts.notes}`;

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.8,
  });

  const text = completion.choices[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("Model returned an empty draft");
  return text;
}
