// Pure deal extraction for the UberEats deals feature. No network/IO here so it
// stays trivially unit-testable. The network code lives in lib/ubereats.ts.
//
// UberEats tags promotional menu items with an authoritative `promoType` enum
// (BOGO, DISCOUNTED_ITEM, FREE_ITEM, …) under catalogItemAnalyticsData. We key off
// that enum rather than scanning free text — product names like "Alcohol Free
// Beer" or "Free Range Eggs" would otherwise be misread as free-item deals.

export type Deal = { kind: "bogo" | "free_item"; text: string };

// Map UberEats' item promoType enum to the deal kinds we surface. Everything
// else (DISCOUNTED_ITEM, percent/dollar off, none) is intentionally dropped —
// the feature is BOGO + free-item only.
export function kindFromPromoType(promoType: string | null | undefined): Deal["kind"] | null {
  if (!promoType) return null;
  const p = promoType.toUpperCase();
  if (p.includes("BOGO") || p.includes("BUY")) return "bogo";
  if (p.includes("FREE")) return "free_item";
  return null;
}

// Recursively gather every string value from an arbitrary JSON-like value.
// Used by lib/ubereats.ts to detect whether a store's feed signposts carry any
// offer signal (the cost gate before fetching the full storefront).
export function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) collectStrings(v, out);
  return out;
}

type CatalogItem = {
  title?: string;
  catalogItemAnalyticsData?: { promoType?: string | null };
};

// Recursively collect every catalog item (any object carrying
// catalogItemAnalyticsData) from a storefront payload, resilient to the exact
// nesting path under catalogSectionsMap changing.
function findCatalogItems(node: unknown, out: CatalogItem[] = []): CatalogItem[] {
  if (Array.isArray(node)) {
    for (const v of node) findCatalogItems(v, out);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("catalogItemAnalyticsData" in o) out.push(o as CatalogItem);
    for (const v of Object.values(o)) findCatalogItems(v, out);
  }
  return out;
}

function sanitize(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

// Pull BOGO/free-item deals from a storefront JSON payload by inspecting each
// promo-tagged catalog item. The item title is the human-readable deal text
// (e.g. "Bunch of Tulips (10 Stems)").
export function extractDeals(storeJson: unknown): Deal[] {
  const deals: Deal[] = [];
  const seen = new Set<string>();
  for (const item of findCatalogItems(storeJson)) {
    const kind = kindFromPromoType(item.catalogItemAnalyticsData?.promoType);
    if (!kind) continue;
    const text = sanitize(item.title ?? "");
    if (!text || seen.has(text)) continue;
    seen.add(text);
    deals.push({ kind, text });
  }
  return deals;
}
