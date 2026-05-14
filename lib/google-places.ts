import type { LatLng, Restaurant } from "@/lib/types";

const PLACE_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.primaryType",
  "places.types",
  "places.currentOpeningHours.openNow",
  "places.photos.name",
  "places.websiteUri",
  "places.delivery",
];

const FIELD_MASK = [...PLACE_FIELDS, "nextPageToken"].join(",");

const PRICE_LEVEL_MAP: Record<string, 1 | 2 | 3 | 4> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

type GooglePlace = {
  id: string;
  displayName?: { text: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryType?: string;
  types?: string[];
  currentOpeningHours?: { openNow?: boolean };
  photos?: { name: string }[];
  websiteUri?: string;
  delivery?: boolean;
};

type SearchTextResponse = { places?: GooglePlace[]; nextPageToken?: string };

export async function searchNearby(
  center: LatLng,
  radius = 5000,
  apiKey: string,
  maxResults = 60,
): Promise<Restaurant[]> {
  const collected: GooglePlace[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  while (collected.length < maxResults) {
    const body: Record<string, unknown> = {
      textQuery: "restaurant",
      includedType: "restaurant",
      strictTypeFiltering: true,
      maxResultCount: Math.min(20, maxResults - collected.length),
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius,
        },
      },
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`places searchText ${res.status}: ${text}`);
    }

    const data = (await res.json()) as SearchTextResponse;
    for (const p of data.places ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      collected.push(p);
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return collected.flatMap((p) => {
    if (!p.location || !p.displayName) return [];
    return [
      {
        id: p.id,
        name: p.displayName.text,
        location: { lat: p.location.latitude, lng: p.location.longitude },
        address: p.formattedAddress ?? "",
        rating: p.rating ?? null,
        userRatingCount: p.userRatingCount ?? null,
        priceLevel: p.priceLevel ? PRICE_LEVEL_MAP[p.priceLevel] ?? null : null,
        primaryType: p.primaryType ?? null,
        types: p.types ?? [],
        openNow: p.currentOpeningHours?.openNow ?? null,
        photoName: p.photos?.[0]?.name ?? null,
        websiteUri: p.websiteUri ?? null,
        delivery: p.delivery ?? null,
      } satisfies Restaurant,
    ];
  });
}
