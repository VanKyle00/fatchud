// DoorDash discount deals by parsing the SSR'd /search/store/ HTML. Each store's
// analytics object co-locates store_name/store_latitude/store_longitude, with the
// store's promotion_title ~500-600 chars earlier in the same per-store segment
// (verified 2026-06-05). No formal contract — the page structure can change.
//
// DoorDash gates on TWO signals: TLS/JA3 fingerprint AND IP reputation. The
// fingerprint check blocks Node's vanilla fetch with a 403 even from a
// residential IP (verified 2026-06-05), so we go through cycletls with a Chrome
// JA3 to clear it. The shared proxy URL (PROXY_URL) is passed through for the IP
// signal when the origin is a datacenter (Vercel) — see SCRAPER_NOTES.md.
// Failures return [] so the restaurant simply has no DoorDash deal.

import initCycleTLS, { type CycleTLSClient } from "cycletls";
import { readCache, writeCache } from "@/lib/cache";
import { getProxyUrl } from "@/lib/proxy";
import type { Deal } from "@/lib/deals";

// Chrome 116 UA + matching JA3 fingerprint.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";
const JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";
const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

const MATCH_RADIUS_M = 150;
const TTL_SECONDS = 60 * 60 * 12; // 12h — promos rotate

let tlsClient: CycleTLSClient | null = null;
let tlsInit: Promise<CycleTLSClient> | null = null;

// cycletls spawns a Go subprocess; init once and reuse. Concurrent callers share
// the in-flight init promise.
async function getTLSClient(): Promise<CycleTLSClient> {
  if (tlsClient) return tlsClient;
  if (tlsInit) return tlsInit;
  tlsInit = initCycleTLS().then(
    (c) => {
      tlsClient = c;
      tlsInit = null;
      return c;
    },
    (e) => {
      tlsInit = null;
      throw e;
    },
  );
  return tlsInit;
}

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
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?lat=${lat}&lng=${lng}`;
  const tls = await getTLSClient();
  const proxy = getProxyUrl();
  const res = await tls(url, {
    ja3: JA3,
    userAgent: UA,
    headers: BROWSER_HEADERS,
    timeout: 20,
    ...(proxy && { proxy }),
  });
  if (res.status < 200 || res.status >= 300) throw new Error(`doordash search ${res.status}`);
  return typeof res.data === "string" ? res.data : await res.text();
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
