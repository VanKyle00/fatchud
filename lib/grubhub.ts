// Grubhub availability check via their anonymous-auth web API.
// CLIENT_ID is extracted from their public grubhub-config-*.js bundle and
// rotates periodically. If `auth` returns 401 we re-extract automatically
// from the live grubhub.com HTML and retry once. See SCRAPER_NOTES.md.

const AUTH_URL = "https://api-gtm.grubhub.com/auth";
const SEARCH_URL = "https://api-gtm.grubhub.com/restaurants/search/search_listing";
const ENTRY_URL = "https://www.grubhub.com/";
const ASSET_BASE = "https://assets.grubhub.com/";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const CONFIG_FILE_RE = /grubhub-config-[a-z0-9_]+\.js/;
const CLIENT_ID_RE = /clientId"\s*:\s*"(beta_[A-Za-z0-9]+)"/;

const DEVICE_ID = Math.floor(Math.random() * 1e9);
const ROTATION_COOLDOWN_MS = 5 * 60 * 1000;

let cachedClientId = "beta_UmWlpstzQSFmocLy3h1UieYcVST";
let lastRotationAt = 0;
let rotationInFlight: Promise<string> | null = null;

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

async function extractClientId(): Promise<string> {
  const entryRes = await fetch(ENTRY_URL, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!entryRes.ok) throw new Error(`grubhub entry ${entryRes.status}`);
  const html = await entryRes.text();
  const fileMatch = html.match(CONFIG_FILE_RE);
  if (!fileMatch) throw new Error("grubhub: config bundle filename not found");

  const configRes = await fetch(`${ASSET_BASE}${fileMatch[0]}`, {
    headers: { "User-Agent": UA },
  });
  if (!configRes.ok) throw new Error(`grubhub config ${configRes.status}`);
  const js = await configRes.text();
  const idMatch = js.match(CLIENT_ID_RE);
  if (!idMatch) throw new Error("grubhub: clientId not found in config bundle");
  return idMatch[1];
}

async function rotateClientId(): Promise<string> {
  if (rotationInFlight) return rotationInFlight;
  if (Date.now() - lastRotationAt < ROTATION_COOLDOWN_MS) {
    throw new Error("grubhub: rotation cooldown");
  }
  lastRotationAt = Date.now();

  rotationInFlight = (async () => {
    try {
      const next = await extractClientId();
      if (next !== cachedClientId) {
        console.warn(`[grubhub] rotated CLIENT_ID ${cachedClientId} -> ${next}`);
        cachedClientId = next;
      }
      return next;
    } finally {
      rotationInFlight = null;
    }
  })();
  return rotationInFlight;
}

async function postAuth(clientId: string): Promise<Response> {
  return fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      brand: "GRUBHUB",
      client_id: clientId,
      device_id: DEVICE_ID,
      scope: "anonymous",
    }),
  });
}

async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now) return cachedToken.token;

  let res = await postAuth(cachedClientId);
  if (res.status === 401) {
    const next = await rotateClientId();
    res = await postAuth(next);
  }
  if (!res.ok) throw new Error(`grubhub auth ${res.status}`);

  const data = (await res.json()) as {
    session_handle?: { access_token?: string; token_expire_time?: number };
  };
  const token = data.session_handle?.access_token;
  if (!token) throw new Error("grubhub auth: no token");
  const ttl = data.session_handle?.token_expire_time
    ? data.session_handle.token_expire_time - now
    : 3600_000;
  cachedToken = { token, expiresAt: now + Math.min(ttl, 3600_000) - 60_000 };
  return token;
}

type GrubhubResult = {
  name: string;
  delivery: boolean;
  address: { latitude: string; longitude: string };
};

async function searchGrubhub(query: string, lat: number, lng: number): Promise<GrubhubResult[]> {
  const token = await getToken();
  const params = new URLSearchParams({
    orderMethod: "delivery",
    locationMode: "DELIVERY",
    facetSet: "umamiV2",
    pageSize: "10",
    hideHateoasLinks: "true",
    queryText: query,
    location: `POINT(${lng} ${lat})`,
    preciseLocation: "true",
  });
  const res = await fetch(`${SEARCH_URL}?${params}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`grubhub search ${res.status}`);
  const data = (await res.json()) as { results?: GrubhubResult[] };
  return data.results ?? [];
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

export async function isOnGrubhub(name: string, lat: number, lng: number): Promise<boolean> {
  const key = `${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const now = Date.now();
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  let result = false;
  try {
    const results = await searchGrubhub(name, lat, lng);
    const target = normalizeName(name);
    for (const r of results) {
      if (!r.delivery) continue;
      const rLat = parseFloat(r.address.latitude);
      const rLng = parseFloat(r.address.longitude);
      if (!Number.isFinite(rLat) || !Number.isFinite(rLng)) continue;
      if (haversineMeters(lat, lng, rLat, rLng) > MATCH_RADIUS_M) continue;
      const candidate = normalizeName(r.name);
      if (candidate.includes(target) || target.includes(candidate)) {
        result = true;
        break;
      }
    }
  } catch (err) {
    console.warn(`[grubhub] "${name}" failed:`, err instanceof Error ? err.message : err);
    result = false;
  }

  availabilityCache.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}
