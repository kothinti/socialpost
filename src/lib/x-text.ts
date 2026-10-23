import twitterText from "twitter-text";
export const X_CHARACTER_LIMIT = 280;
export function xTextLength(text: string) {
  return twitterText.parseTweet(text).weightedLength;
}
export function validateXText(text: string): string | null {
  const parsed = twitterText.parseTweet(text);
  if (!text.trim()) return "Write something first";
  if (parsed.weightedLength > X_CHARACTER_LIMIT)
    return `X allows at most 280 weighted characters (${parsed.weightedLength}/280)`;
  if (!parsed.valid) return "Post contains characters X does not accept";
  return null;
}
