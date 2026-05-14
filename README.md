# FatChud.me

Web app for figuring out where to order delivery from. Shows nearby restaurants on a map, checks which of DoorDash / UberEats / Grubhub actually carry each one, and only surfaces "order on platform X" buttons for the platforms where the restaurant was found. Mark places you've been and the pins turn green.

Built with Next.js 16, React 19, TypeScript, Tailwind v4, and MapLibre GL JS over OpenFreeMap tiles — so no Mapbox or Google Maps fees on map rendering. The only paid dependency is Google Places (New) for restaurant data.

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
- **DoorDash** — No API at all. Fetch the server-rendered `/search/store/<query>/` page and regex-parse the analytics payload embedded in the React Server Components stream for `store_name`/`store_latitude`/`store_longitude` triples. (`lib/doordash.ts`)

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

## Operational notes

All three scrapers reverse-engineer public web endpoints with no formal contract — see `SCRAPER_NOTES.md` for documented per-platform failure modes, recovery procedures, and how to drop a platform entirely if it stops working. The Grubhub rotation logic is the only fully automatic recovery; UberEats and DoorDash breakages still require human eyes.
