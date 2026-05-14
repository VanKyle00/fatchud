// Two-tier cache for scraper results.
//
// L1 (in-memory): per-Vercel-instance Map. Free, instant, dies on cold start.
// L2 (Vercel KV / Redis): persistent across cold starts and instances. ~10-30ms
//   per read; auto-provisioned env vars (KV_REST_API_URL, KV_REST_API_TOKEN)
//   appear when you connect a KV store via the Vercel Storage tab.
//
// When KV env vars are unset (local dev) we silently fall back to L1 only —
// the app still works, just without persistence across server restarts.

import { kv } from "@vercel/kv";

const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();

let kvConfigured: boolean | undefined;
function isKvConfigured(): boolean {
  if (kvConfigured !== undefined) return kvConfigured;
  kvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
  return kvConfigured;
}

export async function readCache<T>(key: string): Promise<T | null> {
  const cached = memoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) memoryCache.delete(key);

  if (!isKvConfigured()) return null;

  try {
    const value = await kv.get<T>(key);
    if (value === null || value === undefined) return null;
    // Backfill L1 — KV's own TTL still governs the authoritative expiry, but
    // we cache locally for an hour so warm-instance hits don't keep hammering KV.
    memoryCache.set(key, { value, expiresAt: Date.now() + 60 * 60 * 1000 });
    return value;
  } catch (err) {
    console.warn(`[cache] KV read failed for "${key}":`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function writeCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  if (!isKvConfigured()) return;
  try {
    await kv.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    console.warn(`[cache] KV write failed for "${key}":`, err instanceof Error ? err.message : err);
  }
}
