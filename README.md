# FatChud.me

Web app for figuring out where to order delivery from. Shows nearby restaurants on a map, checks which of DoorDash / UberEats / Grubhub actually carry each one, and only surfaces "order on platform X" buttons for the platforms where the restaurant was found. Mark places you've been and the pins turn green.

Built with Next.js 16, React 19, TypeScript, Tailwind v4, and MapLibre GL JS over OpenFreeMap tiles — so no Mapbox or Google Maps fees on map rendering. The only paid dependency is Google Places (New) for restaurant data.

## System design

![FatChud.me system design](public/system-design.svg)

## Features

- **Map-first discovery.** Up to 60 nearby restaurants from Google Places, plotted as rating-bearing pins.
- **Cross-platform delivery check.** Every shown restaurant has been independently verified on each delivery platform in parallel. If nothing carries it, it doesn't appear at all.
- **Smart order buttons.** Per-restaurant deep-link buttons appear only for platforms where the restaurant was found — no dead links.
- **"Been here" tracking.** Click a checkbox to mark a visit; pins turn green and persist across sessions via `localStorage`.
- **Random picker with visited filters.** Spin a roulette-style picker with three modes: all restaurants, exclude visited, or only visited.
- **No-permission default location.** IP-based geolocation with multi-provider fallback puts the user roughly where they are without a browser prompt. Address input upgrades to precise centering.

## Interesting bits

### Three completely different scraping strategies

Each delivery platform exposes a wildly different surface, so each scraper attacks the problem differently:

- **Grubhub** — Real OAuth-style anonymous auth: `POST /auth` with a public client ID, get a bearer token, hit `/restaurants/search/search_listing`. (`lib/grubhub.ts`)
- **UberEats** — Undocumented but completely unauthenticated public endpoint at `/api/getFeedV1` with a literal `x-csrf-token: x` header. No tokens, no signing — just works. (`lib/ubereats.ts`)
- **DoorDash** — *Disabled in production.* The original approach was to fetch the server-rendered `/search/store/<query>/` page and regex-parse `store_name`/`store_latitude`/`store_longitude` triples out of the React Server Components stream. Cloudflare/Datadome now block every scrape attempt from Vercel — see [Enabling DoorDash scraping locally](#enabling-doordash-scraping-locally) below for what's required to get it working on a local clone. The DoorDash order button still renders unconditionally as a best-effort deep link.

### Self-healing Grubhub auth

Grubhub rotates their public `clientId` every few weeks, breaking the auth flow. The scraper detects this and recovers without manual intervention:

1. On a 401 from `/auth`, fetch `https://www.grubhub.com/` and grep the HTML for the current `grubhub-config-*.js` bundle filename
2. Fetch that bundle from `https://assets.grubhub.com/`, regex-extract the new `clientId`
3. Update the in-memory cache and retry the auth once

Concurrency-safe via an in-flight Promise lock so a flood of 401s shares a single recovery attempt, and rate-limited to one rotation per 5 minutes per process so a broken extraction doesn't hammer Grubhub.

### Cross-source restaurant matching

A restaurant's name on Google Places rarely matches its name on a delivery platform exactly — "Joe's Pizza" vs "Joe's Pizza (Greenpoint)" vs "Joe's Pizza Restaurant". The match logic in each scraper:

1. **Normalize**: lowercase, strip parentheticals, collapse to alphanumeric-only
2. **Bidirectional substring**: either normalized name is a substring of the other
3. **Coord proximity**: haversine distance <150 m from Google's coordinates — filters out chain locations 20 miles away that happen to share the name

### Multi-provider IP geolocation fallback

Default centering tries three providers in sequence — `ipapi.co`, `geojs.io`, `ipwho.is` — each with their own JSON shape and quirks. First success wins. If all three fail, the map shows a world view and the address input still works. Single-provider rate limits stop being an outage.

### Imperatively-managed map markers

Pins live in a `Map<id, MapLibreMarker>` ref rather than re-rendering React on every state change. Selected/visited states toggle class names on the existing DOM elements, so the only React work that touches markers is when the restaurant list itself changes. On the first IP-center arrival the app uses `jumpTo` (instant) instead of `flyTo` (slow animated zoom from world view) to avoid the perception that the map is stuck on a global view.

### Field-masked Places API with pagination

Google's Places API (New) prices by field-mask SKU tier. The query requests exactly the fields the UI renders — dropping any one bumps the call down a tier. For higher result counts the app uses `places:searchText` with `nextPageToken` pagination (3 pages × 20 = up to 60 results) instead of `places:searchNearby`'s hard 20-result cap.

## Local development

```bash
npm install
cp .env.local.example .env.local
# Add your GOOGLE_API_KEY
npm run dev
```

Requires a Google Cloud project with **Places API (New)** and **Geocoding API** enabled. Restrict the key to HTTP referrers from your deployment domain — the only credential is server-side, but a leaked unrestricted key is still cheap to abuse.

### DoorDash scraping (deals + availability)

DoorDash is **active**: both the deals tab and the verified availability check (`/api/doordash-check`) run through `lib/doordash.ts` via `cycletls` (a Chrome JA3 handshake). It works from a residential origin out of the box — no manual enabling needed.

**Why DoorDash needs cycletls — and why Vercel is still unverified:**

DoorDash's edge stack gates on two independent signals:

- **TLS fingerprint (JA3) — the real blocker.** Node's default TLS ClientHello looks nothing like Chrome's, so DoorDash returns `403` to a plain `fetch` **even from a residential IP** (verified: `curl` from the same IP gets `200`). `lib/doordash.ts` uses `cycletls` to present a Chrome JA3, which clears it. This corrects an earlier assumption that a vanilla residential `fetch` would work — it does not.
- **IP reputation.** Direct fetches from Vercel's datacenter IP ranges also get `403` from Cloudflare. From a residential origin the IP is already fine; on Vercel you'd additionally need a residential `PROXY_URL` (passed through to cycletls), but that combination is unverified — a paid web-unlocker (Bright Data, ScraperAPI) would be the reliable path.

DoorDash availability is now resolved lazily via `/api/doordash-check` (cycletls Chrome-JA3 transport) and is **tri-state**: `"yes"` (confirmed — counts toward the list), `"no"` (confirmed absent — button hidden), `"unknown"` (blocked/errored — best-effort button still shows, not counted). Because the list filter is OR across platforms, re-enabling DoorDash can only *add* DoorDash-exclusive restaurants, never shrink the list. On a blocked origin (e.g. a Vercel datacenter IP, still unverified) every result is `"unknown"`, which is a no-op versus the old hardcoded behavior — no regression.

## Operational notes

All three scrapers reverse-engineer public web endpoints with no formal contract — see `SCRAPER_NOTES.md` for documented per-platform failure modes, recovery procedures, and how to drop a platform entirely if it stops working. The Grubhub rotation logic is the only fully automatic recovery; UberEats and DoorDash breakages still require human eyes.
