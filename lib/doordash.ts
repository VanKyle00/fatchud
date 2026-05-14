// DoorDash availability check by parsing the SSR'd /search/store/ HTML for
// the analytics payload embedded in the RSC stream. No auth or API key — but
// also no formal contract, so the page structure can change without warning.
//
// DoorDash sits behind Cloudflare/Datadome which pre-blocks both datacenter
// IPs and requests with non-browser TLS fingerprints. Production needs both:
//   1. A residential IP via DOORDASH_PROXY_URL env var
//   2. A Chrome-like TLS fingerprint via cycletls (spawns a Go subprocess)
//
// When DOORDASH_PROXY_URL is unset, falls back to plain fetch — works from
// any residential network, fails (403) from any cloud runtime.
//
// next.config.ts must include the linux x64 cycletls binary via
// outputFileTracingIncludes for `/api/delivery-check` to find it at runtime.

import initCycleTLS, { type CycleTLSClient } from "cycletls";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";

// Chrome 116 JA3 fingerprint
const JA3 =
  "771,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,0-23-65281-10-11-35-16-5-13-18-51-45-43-27-17513,29-23-24,0";

const BROWSER_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

const STORE_RE =
  /\\"store_latitude\\":([0-9.\-]+),\\"store_longitude\\":([0-9.\-]+),\\"store_name\\":\\"([^"\\]+)\\"/g;

type Hit = { name: string; lat: number; lng: number };

let tlsClient: CycleTLSClient | null = null;
let tlsInit: Promise<CycleTLSClient> | null = null;

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

async function fetchDoorDash(url: string): Promise<{ status: number; body: string }> {
  const proxy = process.env.DOORDASH_PROXY_URL;
  if (proxy) {
    const tls = await getTLSClient();
    const res = await tls(url, {
      ja3: JA3,
      userAgent: UA,
      proxy,
      headers: BROWSER_HEADERS,
      timeout: 15,
    });
    const body = typeof res.data === "string" ? res.data : await res.text();
    return { status: res.status, body };
  }
  const res = await fetch(url, {
    headers: { "User-Agent": UA, ...BROWSER_HEADERS },
  });
  return { status: res.status, body: await res.text() };
}

async function searchDoorDash(query: string, lat: number, lng: number): Promise<Hit[]> {
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?lat=${lat}&lng=${lng}`;
  const { status, body } = await fetchDoorDash(url);
  if (status < 200 || status >= 300) throw new Error(`doordash search ${status}`);

  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(STORE_RE)) {
    const sLat = parseFloat(m[1]);
    const sLng = parseFloat(m[2]);
    const sName = m[3];
    if (!Number.isFinite(sLat) || !Number.isFinite(sLng)) continue;
    const key = `${sName}|${sLat}|${sLng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push({ name: sName, lat: sLat, lng: sLng });
  }
  return hits;
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

const MATCH_RADIUS_M = 150;
const TTL_MS = 1000 * 60 * 60 * 24 * 7;
const availabilityCache = new Map<string, { result: boolean; expiresAt: number }>();

export async function isOnDoorDash(name: string, lat: number, lng: number): Promise<boolean> {
  const key = `${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const now = Date.now();
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  let result = false;
  try {
    const hits = await searchDoorDash(name, lat, lng);
    const target = normalizeName(name);
    for (const h of hits) {
      if (haversineMeters(lat, lng, h.lat, h.lng) > MATCH_RADIUS_M) continue;
      const candidate = normalizeName(h.name);
      if (candidate.includes(target) || target.includes(candidate)) {
        result = true;
        break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const cause =
      err instanceof Error && "cause" in err && err.cause
        ? err.cause instanceof Error
          ? `${err.cause.name}: ${err.cause.message}`
          : String(err.cause)
        : null;
    console.warn(`[doordash] "${name}" failed: ${msg}${cause ? ` (cause: ${cause})` : ""}`);
    result = false;
  }

  availabilityCache.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}
