import type { FilterState, Restaurant } from "@/lib/types";

export const DEFAULT_FILTER: FilterState = {
  minRating: 4.0,
  cuisines: [],
  maxPrice: 4,
  openNow: false,
};

export function applyFilters(restaurants: Restaurant[], filter: FilterState): Restaurant[] {
  return restaurants.filter((r) => {
    if (filter.minRating > 0 && (r.rating ?? 0) < filter.minRating) return false;
    if (filter.cuisines.length > 0) {
      const cuisine = r.primaryType ?? r.types[0] ?? "";
      if (!filter.cuisines.includes(cuisine)) return false;
    }
    if (r.priceLevel !== null && r.priceLevel > filter.maxPrice) return false;
    if (filter.openNow && r.openNow !== true) return false;
    return true;
  });
}

export function availableCuisines(restaurants: Restaurant[]): string[] {
  const seen = new Set<string>();
  for (const r of restaurants) {
    const c = r.primaryType ?? r.types[0];
    if (c) seen.add(c);
  }
  return Array.from(seen).sort();
}
