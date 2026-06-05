// DoorDash discount deals by parsing the SSR'd /search/store/ HTML. Each store's
// analytics object co-locates store_name/store_latitude/store_longitude, with the
// store's promotion_title ~500-600 chars earlier in the same per-store segment
// (verified 2026-06-05). No formal contract — the page structure can change.
//
// DoorDash gates on IP reputation AND TLS/JA3 fingerprint. From a residential
// origin a plain fetch works; from a datacenter (Vercel) it 403s. The shared
// residential proxy fixes the IP but not the fingerprint — see SCRAPER_NOTES.md.
// Failures return [] so the restaurant simply has no DoorDash deal.

import { readCache, writeCache } from "@/lib/cache";
import { getProxyAgent } from "@/lib/proxy";
import type { Deal } from "@/lib/deals";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MATCH_RADIUS_M = 150;
const TTL_SECONDS = 60 * 60 * 12; // 12h — promos rotate

export type DoorDashStore = { name: string; lat: number; lng: number; promotionTitle: string };

function lastCapture(s: string, re: RegExp): string | null {
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(s)) !== null) last = m[1];
  return last;
}

export function parseDoorDashStores(html: string): DoorDashStore[] {
  const plain = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const anchors: { name: string; idx: number }[] = [];
  const nameRe = /"store_name":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(plain)) !== null) anchors.push({ name: m[1], idx: m.index });

  const out: DoorDashStore[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < anchors.length; i++) {
    const { name, idx } = anchors[i];
    const prev = i > 0 ? anchors[i - 1].idx : 0;
    // Fields for this store live in [prev, idx]; take the match closest to the
    // name (lastCapture) so a previous store's values can't leak forward.
    const win = plain.slice(prev, idx);
    const lat = lastCapture(win, /"store_latitude":(-?[0-9.]+)/g);
    const lng = lastCapture(win, /"store_longitude":(-?[0-9.]+)/g);
    const promo = lastCapture(win, /"promotion_title":"([^"]*)"/g);
    if (lat === null || lng === null) continue;
    const key = `${name}|${lat}|${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat: parseFloat(lat), lng: parseFloat(lng), promotionTitle: promo ?? "" });
  }
  return out;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function fetchSearchHtml(query: string, lat: number, lng: number): Promise<string> {
  const agent = getProxyAgent();
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?lat=${lat}&lng=${lng}`;
  const init = {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
    },
    ...(agent && { dispatcher: agent }),
  } as Parameters<typeof fetch>[1];
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`doordash search ${res.status}`);
  return res.text();
}

export async function getDoorDashDeals(name: string, lat: number, lng: number): Promise<Deal[]> {
  const cacheKey = `scraper:doordash-deals:${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const cached = await readCache<Deal[]>(cacheKey);
  if (cached !== null) return cached;

  let deals: Deal[] = [];
  try {
    const html = await fetchSearchHtml(name, lat, lng);
    const stores = parseDoorDashStores(html);
    const target = normalizeName(name);
    for (const s of stores) {
      if (!s.promotionTitle) continue;
      if (haversineMeters(lat, lng, s.lat, s.lng) > MATCH_RADIUS_M) continue;
      const candidate = normalizeName(s.name);
      if (candidate.includes(target) || target.includes(candidate)) {
        deals = [{ kind: "discount", text: s.promotionTitle, platform: "doordash" }];
        break;
      }
    }
  } catch (err) {
    console.warn(`[doordash deals] "${name}" failed:`, err instanceof Error ? err.message : err);
    deals = [];
  }

  await writeCache(cacheKey, deals, TTL_SECONDS);
  return deals;
}
