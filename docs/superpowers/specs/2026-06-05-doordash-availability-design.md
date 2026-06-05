# DoorDash Availability (verified list + tri-state button) — Design

**Date:** 2026-06-05
**Status:** Approved design, pre-implementation
**Scope:** Phase 3 of the deals/DoorDash work. Re-enables DoorDash *availability* (currently hardcoded `false`) using the cycletls transport built in Phase 2. Builds on `feat/doordash-deals` (PR #2).

## Goal

Use the working DoorDash scraper to populate real availability: surface DoorDash-exclusive restaurants currently filtered out, and make the DoorDash order button accurate (verified) instead of always-on — without slowing the core map load.

## Background (verified current behavior, 2026-06-05)

- **List filter is OR** (`app/page.tsx:54-56`): a restaurant shows if confirmed on *any* platform (`grubhub || ubereats || doordash`). DoorDash is hardcoded `false` (`app/api/delivery-check/route.ts`), so DoorDash-**exclusive** restaurants are filtered out today. Re-enabling can only **add** restaurants, never shrink the list — the README's "shrinks the list" warning is inaccurate for this OR-filter and will be corrected.
- **DoorDash button shows unconditionally** (`components/OrderButtons.tsx:19`, `ALWAYS_SHOW = ["doordash"]`) as a best-effort deep link.
- **DoorDash is reachable via cycletls** (Phase 2): Node `fetch` 403s on JA3 even from residential; cycletls (Chrome JA3) clears it. Vercel/datacenter-IP viability remains unverified.

## Decisions

1. **Tri-state DoorDash result:** `"yes" | "no" | "unknown"`.
2. **Button fallback:** show on `"yes"`/`"unknown"`, hide only on `"no"` (never worse than today).
3. **Integration:** lazy progressive enrichment off the critical path; one consolidated DoorDash fetch feeds both availability and the deals tab.

## Architecture

```
restaurants load
  → POST /api/delivery-check (eager)  → { grubhub, ubereats, doordash: "unknown" }   // unchanged speed; DoorDash not touched here
  → map renders from grubhub/ubereats
  → POST /api/doordash-check (lazy, background)
       → getDoorDashStoreInfo(name,lat,lng) per restaurant  → "yes" | "no" | "unknown"
  → availability.doordash updates; DoorDash-exclusive restaurants pop in, buttons flip to verified

Deals tab (lazy, unchanged trigger)
  → getDoorDashDeals → same getDoorDashStoreInfo (shared cache) → discount from promotionTitle
```

### Data model

`DeliveryAvailability.doordash` (in `app/api/delivery-check/route.ts`) changes from `boolean` to:

```ts
export type DoorDashState = "yes" | "no" | "unknown";
export type DeliveryAvailability = { grubhub: boolean; ubereats: boolean; doordash: DoorDashState };
```

Ripple (all consumers of the availability record): `app/page.tsx` (state type + filter), `components/RestaurantPanel.tsx` + `components/RestaurantCard.tsx` (prop pass-through), `components/OrderButtons.tsx` (show logic). `DealsPanel` is unaffected (separate deal data).

- **List filter** (`page.tsx`): `a.grubhub || a.ubereats || a.doordash === "yes"`.
- **OrderButtons**: DoorDash visible when `doordash !== "no"`; Grubhub/UberEats unchanged (`true` only). `ALWAYS_SHOW` removed.

### Consolidated fetch (`lib/doordash.ts`)

- `getDoorDashStoreInfo(name, lat, lng): Promise<{ matched: boolean; promotionTitle: string }>` — fetch search HTML via cycletls (existing `fetchSearchHtml`), `parseDoorDashStores` (existing, unit-tested), match by normalized name + <150 m haversine. Returns the matched store's `promotionTitle` (or `""`). Cached once as `scraper:doordash:<normName>|lat|lng`, 12 h TTL. **Throws** on fetch error (so callers can distinguish error from not-found).
- `getDoorDashDeals` is rewritten to call `getDoorDashStoreInfo`: `matched && promotionTitle` → `[{ kind:"discount", text: promotionTitle, platform:"doordash" }]`, else `[]`; catch → `[]`. It **drops its own `scraper:doordash-deals` cache** — caching now lives solely in `getDoorDashStoreInfo` (`scraper:doordash`), so availability and deals share one cache entry and one fetch.
- New `doordashState(name, lat, lng): Promise<DoorDashState>` wraps it: `matched ? "yes" : "no"`, catch → `"unknown"`. Errors are **not cached** (so a later load retries); only definite matched/not-matched results are cached by `getDoorDashStoreInfo`.

### API

- **New `app/api/doordash-check/route.ts`** — `POST { restaurants:[{id,name,lat,lng}] }` → `{ doordash: Record<id, DoorDashState> }`. Fans out `doordashState` with `Promise.all`; invalid items → `"unknown"`.
- **`app/api/delivery-check/route.ts`** — return `doordash: "unknown"` instead of `false`; drop the DoorDash comment about hardcoding.

### Frontend (`app/page.tsx`)

- `availability` state type uses `DoorDashState` for `doordash`.
- New effect: after `restaurants` are set (alongside/after the delivery-check effect), fire `POST /api/doordash-check` in the background; on success, merge each `doordash` state into `availability` (preserving grubhub/ubereats). Non-blocking; failure leaves `doordash:"unknown"`.
- Reset on new restaurant load (same place `setAvailability({})` happens).

## Error handling

- Per-restaurant DoorDash error → `"unknown"` (button still shows; not counted in list). Not cached.
- `/api/doordash-check` bad input → 400, like the other routes.
- DoorDash fully blocked (e.g. Vercel) → every restaurant `"unknown"` → list unchanged vs today, DoorDash buttons still show (best-effort). No regression.

## Performance

- Lazy/background: the eager critical path (map load) is untouched.
- Cold cache: ~60 cycletls page-fetches in the background pass. Warm cache (12 h) makes repeat loads cheap. Consolidation means availability + deals share one fetch per restaurant.
- Bounding cycletls concurrency is a future tuning lever, not built now (YAGNI). Documented as a known cost.

## Docs

- `README.md` + `SCRAPER_NOTES.md`: correct the "keep DoorDash disabled / shrinks the list" guidance to the new reality (tri-state, lazy, cycletls-backed; re-enabling grows the list; Vercel-IP viability still unverified).

## Testing

- Unit: `getDoorDashStoreInfo` derivation over a parsed-store fixture (matched-with-promo, matched-no-promo, no-match) — reuses the existing `parseDoorDashStores` test fixture style. Existing `parseDoorDashStores` tests unchanged.
- Live smoke: `POST /api/doordash-check` from this residential machine returns `"yes"` for a known DoorDash store and `"no"` for an implausible name at the same coords; confirm the deals tab still works (shared fetch).
- `tsc --noEmit` + `next build` clean. No new test framework.

## Non-goals

- Pooled location search (rejected: query-dependent coverage).
- Eager DoorDash in `delivery-check` (rejected: slows critical path).
- Bounded-concurrency pool (future tuning).
- Solving Vercel datacenter-IP access (still unverified; out of scope).

## Open questions

None blocking.
