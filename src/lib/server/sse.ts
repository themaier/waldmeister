// In-memory SSE hub — generic pub/sub by channel name, with a topic registry
// so new real-time streams (tree edits, sync queue, …) can be added by
// registering a topic + authorizer instead of writing another endpoint.
//
// For a single-VPS deploy this is sufficient; once we scale past one process
// we'd swap the pub/sub half for Postgres LISTEN/NOTIFY or Redis, keeping the
// topic/channel API unchanged.

import type { RequestEvent } from '@sveltejs/kit';

type Listener = (payload: unknown) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribe(channel: string, fn: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) listeners.delete(channel);
  };
}

export function publish(channel: string, payload: unknown): void {
  const set = listeners.get(channel);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (e) {
      console.error('SSE listener failed:', e);
    }
  }
}

// ---------- Topic registry ----------
//
// A "topic" is a kind of stream (e.g. "work-order", "sync-queue"). An
// "instance" is a specific stream within a topic, addressed by an id
// (e.g. a work-order UUID). Channels — the hub-level addresses — are
// derived from `${topic}:${id}` so that publish/subscribe stays a single
// map regardless of how many topics we add later.

/**
 * Authorize a subscription. Return true if the caller may listen, false
 * otherwise. Throw a SvelteKit `error(...)` for richer responses (e.g. 404
 * when the instance doesn't exist at all).
 */
export type TopicAuthorizer = (event: RequestEvent, id: string) => Promise<boolean> | boolean;

const topics = new Map<string, TopicAuthorizer>();

export function registerTopic(name: string, authorize: TopicAuthorizer): void {
  topics.set(name, authorize);
}

export function topicAuthorizer(name: string): TopicAuthorizer | undefined {
  return topics.get(name);
}

export function channelFor(topic: string, id: string): string {
  return `${topic}:${id}`;
}
