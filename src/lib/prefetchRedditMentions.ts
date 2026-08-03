import {
  fetchRedditMentions,
  type RedditMentionsPayload,
} from "../api";

/** 탭 전환 체감용 — 직전 성공 응답 재사용 (RedditMentionsTab과 공유) */
let redditMentionsMemory: {
  filter: string;
  payload: RedditMentionsPayload;
} | null = null;

const inflight = new Map<string, Promise<RedditMentionsPayload>>();

export function getRedditMentionsMemory(): {
  filter: string;
  payload: RedditMentionsPayload;
} | null {
  return redditMentionsMemory;
}

export function prefetchRedditMentions(filter = "all-stocks") {
  const key = `${filter}:1:1`;
  if (inflight.has(key)) return inflight.get(key)!;
  if (
    redditMentionsMemory?.filter === filter &&
    Date.now() - (redditMentionsMemory.payload.updatedAt ?? 0) < 4 * 60 * 1000
  ) {
    return Promise.resolve(redditMentionsMemory.payload);
  }
  const p = fetchRedditMentions({ filter, page: 1, pages: 1 })
    .then((data) => {
      redditMentionsMemory = { filter, payload: data };
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}
