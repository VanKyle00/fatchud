// UberEats availability check via their public getFeedV1 endpoint.
// No real auth — just an x-csrf-token: x header. The endpoint shape can change
// without notice; failures return false so the restaurant gets filtered out.

const SEARCH_URL = "https://www.ubereats.com/api/getFeedV1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";

type UberFeedItem = {
  store?: {
    title?: { text?: string };
    mapMarker?: { latitude?: number; longitude?: number };
  };
};

let firstCallDiagLogged = false;

async function searchUberEats(query: string, lat: number, lng: number): Promise<UberFeedItem[]> {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": "x",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({
      userQuery: query,
      pageInfo: { offset: 0, pageSize: 8 },
      placeInfo: {
        addressLine1: "",
        latitude: lat,
        longitude: lng,
        source: "google_places",
        type: "google_places",
      },
    }),
  });
  if (!res.ok) throw new Error(`ubereats search ${res.status}`);

  const bodyText = await res.text();
  let parsed: { data?: { feedItems?: UberFeedItem[] } } & Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    console.warn(
      `[ubereats] "${query}" returned non-JSON body (${bodyText.length} bytes): ${bodyText.slice(0, 200)}`,
    );
    return [];
  }

  const items = parsed.data?.feedItems ?? [];

  if (!firstCallDiagLogged) {
    firstCallDiagLogged = true;
    const topKeys = Object.keys(parsed ?? {}).join(",");
    const dataKeys = parsed.data ? Object.keys(parsed.data).join(",") : "(no data field)";
    const firstStore = items[0]?.store;
    const firstStoreKeys = firstStore ? Object.keys(firstStore).join(",") : "(no store on first item)";
    const firstTitle = items[0]?.store?.title?.text ?? "(none)";
    console.warn(
      `[ubereats diag] q="${query}" status=${res.status} top={${topKeys}} data={${dataKeys}} items=${items.length} firstStore={${firstStoreKeys}} firstTitle="${firstTitle}"`,
    );
  }

  return items;
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

export async function isOnUberEats(name: string, lat: number, lng: number): Promise<boolean> {
  const key = `${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const now = Date.now();
  const cached = availabilityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;

  let result = false;
  try {
    const items = await searchUberEats(name, lat, lng);
    const target = normalizeName(name);
    for (const item of items) {
      const title = item.store?.title?.text;
      const m = item.store?.mapMarker;
      if (!title || typeof m?.latitude !== "number" || typeof m.longitude !== "number") continue;
      if (haversineMeters(lat, lng, m.latitude, m.longitude) > MATCH_RADIUS_M) continue;
      const candidate = normalizeName(title);
      if (candidate.includes(target) || target.includes(candidate)) {
        result = true;
        break;
      }
    }
  } catch (err) {
    console.warn(`[ubereats] "${name}" failed:`, err instanceof Error ? err.message : err);
    result = false;
  }

  availabilityCache.set(key, { result, expiresAt: now + TTL_MS });
  return result;
}
