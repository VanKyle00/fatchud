// DoorDash availability check by parsing the SSR'd /search/store/ HTML for
// the analytics payload embedded in the RSC stream. No auth or API key — but
// also no formal contract, so the page structure can change without warning.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const STORE_RE =
  /\\"store_latitude\\":([0-9.\-]+),\\"store_longitude\\":([0-9.\-]+),\\"store_name\\":\\"([^"\\]+)\\"/g;

type Hit = { name: string; lat: number; lng: number };

async function searchDoorDash(query: string, lat: number, lng: number): Promise<Hit[]> {
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?lat=${lat}&lng=${lng}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`doordash search ${res.status}`);
  const html = await res.text();
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(STORE_RE)) {
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
    console.warn(`[doordash] "${name}" failed:`, err instanceof Error ? err.message : err);
    result = false;
  }

  availabilityCache.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}
