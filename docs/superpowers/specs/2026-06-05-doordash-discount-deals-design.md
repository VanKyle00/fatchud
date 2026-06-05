# DoorDash Discount Deals — Design

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Scope:** Phase 2 of the deals feature. Adds DoorDash %/$ discount deals. Builds on Phase 1 (UberEats BOGO/free-item, branch `feat/ubereats-deals` / PR #1).

## Goal

Surface nearby restaurants' DoorDash **discount** offers (`% off` / `$ off on $X+`) in the existing Deals tab, alongside the UberEats BOGO/free-item deals.

## Background / Feasibility (verified live, 2026-06-05, residential IP)

- **DoorDash store search exposes discounts cleanly.** `doordash.com/search/store/<q>/?lat=&lng=` returns an RSC stream where each store's analytics object co-locates `store_name`, `store_latitude`, `store_longitude`, and `promotion_title`. Verified: 50 stores per query, ~12 with a non-empty `promotion_title` like `"$5 off on $35+"` / `"20% off on $20+"`, each correctly attributable to its store by name + coords.
- **BOGO is NOT at the store-search level.** Across six deal-heavy queries, every store-level `promotion_title` was a `%`/`$` discount; `promotion_type` was empty. DoorDash BOGO exists only *inside* store menu pages as a `(BOGO)` suffix in item names (e.g. "Rigatoni Bolognese (BOGO)") — out of scope for this phase (would require a heavy per-store-page drill with no cheap gate).
- **Works from a residential IP, blocked on Vercel.** Plain `fetch` returns HTTP 200 here (Charter/residential). From Vercel's datacenter IPs, Cloudflare/Datadome returns 403. Two gate signals: IP reputation AND TLS/JA3 fingerprint.

## Scope

**In scope:**
- New deal kind `discount`, sourced from each store's DoorDash `promotion_title`.
- Shared residential-proxy route for DoorDash and UberEats.

**Non-goals (this phase):**
- DoorDash BOGO/free-item (item-level menu drill) — deferred.
- UberEats discounts — UberEats stays BOGO/free-item only.
- Building cycletls/JA3 spoofing up front — documented fallback only.
- Solving Vercel production access definitively — we ship the proxy route and verify empirically.

## Architecture

```
app/api/deals (per restaurant, in parallel)
   → Promise.all([
        getUberEatsDeals(name,lat,lng),   // existing: bogo/free_item, platform "ubereats"
        getDoorDashDeals(name,lat,lng),   // new: discount, platform "doordash"
     ]) → merged Deal[]
   → { deals: Record<id, Deal[]> }
   → DealsPanel renders deal badges + per-platform order buttons
```

### Data model (`lib/deals.ts`, modify)

```ts
export type Deal = {
  kind: "bogo" | "free_item" | "discount";
  text: string;
  platform: "ubereats" | "doordash";
};
```

- UberEats `extractDeals` stamps `platform: "ubereats"` on every returned deal (kinds unchanged).
- `kindFromPromoType` unchanged (UberEats only).

### Shared proxy (`lib/proxy.ts`, new)

```ts
export function getProxyAgent(): ProxyAgent | null
```

- Reads `process.env.PROXY_URL ?? process.env.UBEREATS_PROXY_URL` (back-compat). Memoized.
- `lib/ubereats.ts` drops its inline `getProxyAgent` and imports this one (small DRY refactor of shipped code).

### DoorDash data layer (`lib/doordash.ts`, restored/new)

- `parseDoorDashStores(html: string): { name: string; lat: number; lng: number; promotionTitle: string }[]` — **pure**. Unescapes the RSC stream and extracts each per-store record's co-located `store_name` / `store_latitude` / `store_longitude` / `promotion_title`. The testable core.
- `getDoorDashDeals(name, lat, lng): Promise<Deal[]>`:
  - Fetch `https://www.doordash.com/search/store/<encoded name>/?lat=&lng=` through the shared proxy agent, browser-like headers (UA + Accept/Sec-Fetch from the old scraper).
  - Match a parsed store by normalized name (lowercase, strip parentheticals, alphanumeric) + haversine < `MATCH_RADIUS_M` (150 m).
  - Non-empty `promotionTitle` → `[{ kind: "discount", text: promotionTitle, platform: "doordash" }]`.
  - Cache key `scraper:doordash-deals:<normName>|lat(3dp)|lng(3dp)`, 12 h TTL, existing two-tier cache.
  - Any failure (parse, non-2xx incl. 403 from datacenter, network) → `[]`, silent-degrade (per SCRAPER_NOTES.md).

### API (`app/api/deals/route.ts`, modify)

Per restaurant, `Promise.all([getUberEatsDeals(...), getDoorDashDeals(...)])`, concat into one `Deal[]`. Response shape unchanged: `{ deals: Record<string, Deal[]> }`.

### UI (`components/DealsPanel.tsx`, modify)

- `KIND_LABEL` gains `discount: "Discount"`.
- Deals now carry `platform`; render an order button for each distinct platform present in a restaurant's deals (reuse `orderUrl(platform, name)` + existing button styling), instead of the hardcoded single UberEats button.
- A restaurant appears if it has ≥1 deal from any platform. Empty/loading states unchanged.

## Production access & verification

- DoorDash + UberEats both route through the shared residential proxy when `PROXY_URL`/`UBEREATS_PROXY_URL` is set.
- DoorDash from a residential **origin** needs no proxy (verified). On Vercel, the proxy fixes the IP but may still trip DoorDash's TLS/JA3 check.
- **Verification step (in the plan):** after building, test whether proxy-alone clears DoorDash from a datacenter-like origin. If fingerprint-blocked, the documented fallback is to layer `cycletls` (Chrome JA3) on the same proxy — restored from the old `lib/doordash.ts` in git history. Not built up front.
- Net behavior: DoorDash deals show wherever the server can reach DoorDash (residential dev/self-host always; Vercel only if the proxy route clears the fingerprint). Silent-absent otherwise — same graceful-degrade model as the existing DoorDash availability.

## Error handling

- Per-platform, per-restaurant failures isolated to `[]` for that platform.
- `/api/deals` bad input → 400 (unchanged).
- A DoorDash 403 storm on Vercel simply yields no DoorDash deals; UberEats deals and the rest of the app are unaffected.

## Testing

- `parseDoorDashStores` — pure, unit-tested against a trimmed real RSC fixture (asserts name/coord/promotion_title extraction and that empty-promo stores are excluded).
- Updated `extractDeals`/`Deal` tests assert the `platform: "ubereats"` stamp.
- Live smoke test of `getDoorDashDeals` from this residential IP against a known discount-bearing store (e.g. "Bleecker Street Pizza").
- No new test framework (`npx tsx --test`).

## Implementation note (post-build, 2026-06-05)

The spec assumed plain `fetch` works from a residential origin and cycletls was a
fallback "not built up front." **Live verification proved that wrong:** Node's
`fetch` is JA3-blocked (403) by DoorDash even on a residential IP (`curl` from
the same IP gets 200 — the blocker is the TLS fingerprint, not the IP). So
cycletls (Chrome JA3) was wired in as the **required** transport for
`getDoorDashDeals`, not a fallback. `lib/proxy.ts` gained `getProxyUrl()` (cycletls
takes a URL string); `next.config.ts` bundles the cycletls Go binary for
`/api/deals`. Verified end-to-end: `/api/deals` returns real DoorDash discounts
(e.g. Bleecker Street Pizza → "$5 off on $35+") through the dev server. Vercel
viability (datacenter IP + proxy) remains unverified.

## Open questions

None blocking. Vercel-via-proxy viability is an explicit verification step, not a precondition.
