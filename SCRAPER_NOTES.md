# Scraper fragility notes

The delivery-availability scrapers in `lib/grubhub.ts`, `lib/ubereats.ts`, and
`lib/doordash.ts` reverse-engineer public web endpoints. They're not contracts.
Expect periodic breakage and check this file when something stops working.

## Shared assumptions

- **Failure mode is silent.** Every scraper catches its own errors and returns
  `false`, so a broken scraper quietly shrinks the visible restaurant list
  rather than throwing. If your list mysteriously empties, hit
  `/api/delivery-check` directly with curl for a known-good restaurant — that
  shows which platform(s) returned `false`.
- **Cache is in-memory.** Each scraper holds a `Map<string, {result, expiresAt}>`
  with a 7-day TTL. A server restart clears all of it. Easy upgrade later: write
  through to `.cache/delivery.json` or SQLite.
- **Name + coord matching.** All three match by normalized name overlap
  (`includes` either direction) AND haversine distance < 150 m from Google's
  coords. Franchises whose listed coords differ between Google and the platform
  by more than that will false-negative. The constant is `MATCH_RADIUS_M` in
  each file — bump it if you find good restaurants being filtered out.
- **Google gate first.** `app/page.tsx` only queries the scrapers for
  restaurants where Google Places returned `delivery === true`. Loosen that to
  `delivery !== false` if your list feels too short before scrapers even run.

## Grubhub (`lib/grubhub.ts`)

- **Auto-rotation is implemented.** The seed `CLIENT_ID = "beta_UmWlpstzQSFmocLy3h1UieYcVST"`
  is held in a mutable `cachedClientId`. When `POST /auth` returns 401,
  `rotateClientId()` fetches `https://www.grubhub.com/`, greps for
  `grubhub-config-*.js`, fetches that bundle from `https://assets.grubhub.com/`,
  and pulls the new `clientId` out via `/clientId":"(beta_[A-Za-z0-9]+)"/`.
  Then `getToken()` retries `/auth` once with the new ID. The new ID is held
  in memory only — a redeploy or cold start re-seeds from the hardcoded value.
- Rotation is rate-limited: at most one extraction attempt per 5 minutes
  per process, and concurrent 401s share a single in-flight rotation promise.
  Watch server logs for `[grubhub] rotated CLIENT_ID ... -> ...` to know it
  fired.
- Real auth flow: `POST /auth` → bearer token → `GET /restaurants/search/search_listing`.
  Tokens cache in-process for ~1h.
- **If rotation itself breaks** (e.g. Grubhub renames the bundle, moves it off
  `assets.grubhub.com`, or changes the `clientId` field name in the JS), do
  the manual recipe to confirm the new patterns, then update `CONFIG_FILE_RE`,
  `ASSET_BASE`, or `CLIENT_ID_RE` in `lib/grubhub.ts`:
  `curl -s --compressed https://www.grubhub.com/ | grep -oE 'grubhub-config-[a-z0-9_]+\.js'`
  then `curl -s --compressed https://assets.grubhub.com/<that>.js | grep -oE 'clientId":"beta_[A-Za-z0-9]+"'`.

## UberEats (`lib/ubereats.ts`)

- **No auth.** Just `x-csrf-token: x` plus a User-Agent on
  `POST /api/getFeedV1`. This is the easiest of the three — and therefore
  the most likely to get tightened later. If it starts returning 403/401
  unexpectedly, they probably added a real CSRF check or signed-request
  requirement.
- **`placeInfo.source: "google_places"`** is a magic string their web app
  uses to indicate the address came from Google. If they ever start requiring
  a real Google `place_id` instead, search results will return empty arrays.
  No errors, just no matches.
- Coordinates come from `feedItems[].store.mapMarker.{latitude,longitude}`.
  If that nested path moves, matching silently breaks — change the type and
  extraction in `searchUberEats`.

## DoorDash (`lib/doordash.ts`)

- **Highest fragility of the three.** No API at all — we parse analytics
  JSON embedded in the server-rendered React Server Components payload at
  `GET /search/store/<q>/`. The regex looks for the exact triple
  `\"store_latitude\":N,\"store_longitude\":N,\"store_name\":\"...\"` in
  order. If DoorDash reorders the fields, renames any of them, or stops
  emitting that analytics payload during SSR, matches go to zero.
- **Cloudflare/Datadome.** The single-request, no-cookie pattern works today.
  If they start gating `/search/store/` on `ddweb_session_id` or a bot-token
  cookie, our fetch will receive a challenge HTML page (or a 403), the regex
  will find nothing, and the function will silently return `false`. The
  cached `true` entries from the past 7 days will still serve, so the
  failure won't be immediately obvious.
- **No location-setting.** We pass `?lat=&lng=` in the URL but DoorDash may
  not honor it strictly — their session/IP may dominate. Mitigated by the
  150m haversine filter, which discards any out-of-area matches.
- **Detection signal.** If you suspect breakage: hit the search URL by hand
  and look for any of: an obviously-different HTML body length (today
  ~2.2 MB of HTML for a real query), a `cf-chl` / `datadome` token in the
  response, or zero matches for the literal regex
  `\\"store_latitude\\":` in the body.

## What to do when a scraper breaks

1. Identify which one: `curl -s -X POST localhost:3000/api/delivery-check
   -H 'Content-Type: application/json' -d '{"restaurants":[{"id":"x",
   "name":"<known good>", "lat":<lat>, "lng":<lng>}]}'`.
2. Open the corresponding `lib/<platform>.ts` and walk through the
   per-platform notes above.
3. If you give up on one platform, drop its column from the response shape
   in `app/api/delivery-check/route.ts` and from the `availability` state +
   `available` filter in `app/page.tsx`. The other two will keep working.
