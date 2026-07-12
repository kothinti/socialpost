import { getSettings, type Settings } from "./db";
import {
  type FeedFilterSettings,
} from "./feed-filters";

export function feedFiltersFromSettings(s: Settings): FeedFilterSettings {
  return {
    topic_keywords: s.topic_keywords ?? [],
    keyword_exact_match: Boolean(s.keyword_exact_match),
    min_like_count: Math.max(0, Number(s.min_like_count) || 0),
    min_reply_count: Math.max(0, Number(s.min_reply_count) || 0),
    min_repost_count: Math.max(0, Number(s.min_repost_count) || 0),
    enable_topic_search: Boolean(s.enable_topic_search),
  };
}

export async function getFeedFilterSettings(
  settings?: Settings,
): Promise<FeedFilterSettings> {
  const s = settings ?? (await getSettings());
  return feedFiltersFromSettings(s);
}
