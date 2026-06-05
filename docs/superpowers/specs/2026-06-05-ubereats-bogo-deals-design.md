# UberEats BOGO & Free-Item Deals — Design

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Scope:** Phase 1 of a deals feature. UberEats only. DoorDash is a separate later phase (see Non-Goals).

## Goal

Surface nearby restaurants that currently advertise a **Buy-One-Get-One-Free (BOGO)** or **free-item** deal on UberEats, in a dedicated "Deals" list inside the existing app.

## Background / Feasibility (verified live, 2026-06-05)

Probed all three platforms from a residential IP:

- **UberEats — usable.** `POST getFeedV1` returns per-store `signposts` (e.g. "2 Offers Available", "Items on sale", "10% off (Spend $30)"). The aggregated "N Offers Available" does not say *what* the offer is, but the storefront endpoint `POST getStoreV1` returns **explicit** offer text ("Free Beef Franks", "20% off", item-level free-item promos) that can be classified. No auth required; geolocates by requesting IP (needs `UBEREATS_PROXY_URL` on Vercel, works directly on residential).
- **DoorDash — richest BOGO text but local-only.** Search-page RSC contains literal "Buy 1 Get 1 Free and more" / "Free Item". Works from residential IP, blocked from Vercel (Cloudflare/Datadome). **Deferred** to a later phase pending a production workaround.
- **Grubhub — dead end.** Offer fields exist in `search_listing` but return empty under the app's anonymous auth; promos appear gated behind a logged-in account. Out of scope.

## Scope

**In scope:**
- Deal kinds: `bogo` and `free_item` **only**. Plain `% off`, `$ off`, and free-delivery deals are explicitly excluded.
- Source: UberEats.
- A "Deals" view reachable via an in-panel tab toggle.

**Non-goals (this phase):**
- DoorDash deals (separate phase — production workaround to be investigated).
- Grubhub deals.
- Discount / free-delivery deals.
- A standalone `/deals` route.
- A new test framework.

## Architecture

Flow mirrors the existing availability path but as an independent, lazily-loaded lane so the critical map-gating path (`/api/delivery-check`) is untouched.

```
page.tsx (Deals tab opened)
   → POST /api/deals { restaurants: [{id,name,lat,lng}] }
       → lib/ubereats.ts getUberEatsDeals(name, lat, lng)   // per restaurant, in parallel
           → getFeedV1 (reused feed call) → match store + read signposts
           → if signpost indicates offers: getStoreV1 → extract + classify offer text
           → return { available, deals: Deal[] }
   → { deals: Record<id, Deal[]> }
   → DealsPanel renders restaurants with non-empty deals
```

### Components / units

**`lib/ubereats.ts` (extend, do not rewrite existing `isOnUberEats`)**
- `export type Deal = { kind: "bogo" | "free_item"; text: string }`
- `classifyOffer(text: string): Deal["kind"] | null` — **pure function**, the testable core.
  - `bogo`: matches /buy\s*(1|one)\s*(get|,)\s*(1|one)\s*free/i, /\b2 for 1\b/i, /\bBOGO\b/i
  - `free_item`: matches /\bfree\b/i on item-style text that is not "free delivery"/"free shipping"
  - else `null` (dropped)
- `getUberEatsDeals(name, lat, lng): Promise<Deal[]>` (returns just the deals — availability has its own path; no unused `available` field)
  - Reuses the feed search already used by `isOnUberEats` (match by normalized name + <150 m haversine — same `MATCH_RADIUS_M`).
  - Reads the matched store's `signposts`. No offer signal → `[]`, no storefront fetch.
  - Offer signal present → one `getStoreV1` fetch; extract candidate offer phrases, run `classifyOffer`, dedupe, keep `bogo` + `free_item`.
  - Cache key `scraper:ubereats-deals:<normalizedName>|lat(3dp)|lng(3dp)`, TTL **12h** (shorter than availability's 7d — promos rotate). Uses existing `readCache`/`writeCache`.
  - Failure → `[]` (silent-degrade, per SCRAPER_NOTES.md philosophy).

**`app/api/deals/route.ts` (new)**
- `POST`, same validation shape as `delivery-check`. Fans out `getUberEatsDeals` over `body.restaurants` with `Promise.all`.
- Returns `{ deals: Record<string, Deal[]> }` (only includes ids with ≥1 deal, or all ids with possibly-empty arrays — implementation detail, panel filters either way).

**`components/DealsPanel.tsx` (new)**
- Props: the restaurant list, `deals: Record<id, Deal[]>`, loading flag, `onSelect`, `visited`.
- Renders only restaurants with ≥1 deal; each row: name, deal text badge(s), rating, existing UberEats order button (reuse `OrderButtons`/`deep-links`).
- Empty state: "No BOGO or free-item deals nearby right now."
- Loading state while the lazy fetch is in flight.

**`components/RestaurantPanel.tsx` / `app/page.tsx` (extend)**
- Add a "Nearby / Deals" tab toggle in the panel header.
- `page.tsx` owns: `view: "nearby" | "deals"` state, `deals` state, and a lazy fetch fired the first time `view === "deals"` (guard against refetch). Reuses current restaurant list + location; no map/location re-fetch.

## Data flow

1. Restaurants already loaded from Google Places (unchanged).
2. User opens Deals tab → one `POST /api/deals` with the current restaurant list.
3. Server fans out per restaurant: feed (reused) → conditional storefront → classify.
4. Panel shows the filtered, deal-bearing subset; selecting one still drives the existing map selection.

## Error handling

- Per-restaurant scraper failure → empty deals, restaurant simply absent from Deals view.
- `/api/deals` bad input → 400, same as `delivery-check`.
- Whole-request failure on the client → Deals view shows the empty/error state; Nearby view unaffected.

## Cost control

- Storefront (`getStoreV1`, ~280 KB) fetched **only** for stores whose feed signpost already flags offers. Offer-free stores cost zero extra requests.
- 12h cache absorbs repeat opens.

## Testing / verification

- `classifyOffer` is pure → verify with a small `node`-run script over real probe strings ("Buy 1 Get 1 Free and more" → bogo; "Free Beef Franks (12 oz)" → free_item; "10% off" → null; "Free delivery" → null).
- Live smoke test against `npm run dev` from this residential machine: open Deals tab, confirm real BOGO/free-item rows appear.
- No new test framework added this phase.

## Open questions

None blocking. DoorDash production workaround tracked as the next phase.
