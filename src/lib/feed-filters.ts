export type FeedFilterSettings = {
  topic_keywords: string[];
  /** When true, each keyword is matched as a contiguous phrase (case-insensitive). */
  keyword_exact_match: boolean;
  min_like_count: number;
  min_reply_count: number;
  min_repost_count: number;
  /** When true and keywords are set, also query X recent search (operators push filters to the API). */
  enable_topic_search: boolean;
};

export function normalizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const kw = item.trim();
    if (!kw) continue;
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}

export function matchesKeywords(
  text: string,
  keywords: string[],
  exactMatch: boolean,
): boolean {
  if (keywords.length === 0) return true;
  const hay = text.toLowerCase();
  return keywords.some((kw) => {
    const needle = kw.toLowerCase().trim();
    if (!needle) return false;
    if (exactMatch) {
      return hay.includes(needle);
    }
    // Loose: every whitespace-separated token must appear somewhere in the text.
    return needle.split(/\s+/).every((token) => token && hay.includes(token));
  });
}

export function meetsEngagement(
  metrics: { likes: number; replies: number; reposts: number },
  filters: Pick<
    FeedFilterSettings,
    "min_like_count" | "min_reply_count" | "min_repost_count"
  >,
): boolean {
  return (
    metrics.likes >= filters.min_like_count &&
    metrics.replies >= filters.min_reply_count &&
    metrics.reposts >= filters.min_repost_count
  );
}

export function passesFeedFilters(
  post: {
    content: string;
    like_count: number;
    reply_count: number;
    repost_count: number;
  },
  filters: FeedFilterSettings,
): boolean {
  if (
    !matchesKeywords(post.content, filters.topic_keywords, filters.keyword_exact_match)
  ) {
    return false;
  }
  return meetsEngagement(
    {
      likes: post.like_count,
      replies: post.reply_count,
      reposts: post.repost_count,
    },
    filters,
  );
}

/**
 * Build an X recent-search query. Engagement operators are applied server-side
 * so fewer tweets are returned (and billed) when thresholds are set.
 */
export function buildTopicSearchQuery(filters: FeedFilterSettings): string | null {
  const keywords = filters.topic_keywords;
  if (keywords.length === 0) return null;

  const phraseParts = keywords.map((kw) => {
    const cleaned = kw.replace(/"/g, "").trim();
    if (!cleaned) return null;
    if (filters.keyword_exact_match) {
      return `"${cleaned}"`;
    }
    return `(${cleaned})`;
  }).filter((p): p is string => Boolean(p));

  if (phraseParts.length === 0) return null;

  const topicClause =
    phraseParts.length === 1 ? phraseParts[0] : `(${phraseParts.join(" OR ")})`;

  const parts = [topicClause, "-is:retweet", "-is:reply"];
  if (filters.min_like_count > 0) {
    parts.push(`min_faves:${filters.min_like_count}`);
  }
  if (filters.min_reply_count > 0) {
    parts.push(`min_replies:${filters.min_reply_count}`);
  }
  if (filters.min_repost_count > 0) {
    parts.push(`min_retweets:${filters.min_repost_count}`);
  }
  return parts.join(" ");
}

export function clampNonNegInt(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}
