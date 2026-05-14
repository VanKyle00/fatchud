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
- **Two-tier cache (`lib/cache.ts`).** L1 is per-instance in-memory Map; L2 is
  Vercel KV (Upstash Redis under the hood). Both share a 7-day TTL on writes;
  L1 reads expire entries on the fly. KV is auto-detected via
  `KV_REST_API_URL` + `KV_REST_API_TOKEN`; when unset (local dev), the system
  silently falls back to L1-only. Per-instance Maps are gone — every scraper
  goes through `readCache`/`writeCache`. Persistent results survive cold
  starts and span instances, so the warm-cache window is no longer a single
  function instance's lifetime.
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
- **Diagnostic logging:** the first UberEats call per cold start emits a
  `[ubereats diag] q="..." status=... top={...} data={...} items=N
  firstStore={...} firstTitle="..."` line in Vercel logs. If `items=0` for
  a query that should obviously match (e.g., search for "pizza" in NYC), the
  endpoint shape changed or they tightened. If `top={status,...}` instead of
  `top={data}`, they're returning an error envelope. If `firstStore` doesn't
  include `mapMarker`, the path moved.

## DoorDash — not verified anymore

DoorDash sits behind Cloudflare/Datadome with both IP-reputation and
TLS-fingerprint blocks. We tried (in order):

1. Direct fetch from Vercel — 403 (datacenter IP blocked)
2. Residential proxy via `DOORDASH_PROXY_URL` — mix of 403 and ECONNRESET
   (proxied IP got through some of the time, but Cloudflare flagged the
   non-browser TLS handshake even when it did)
3. Residential proxy + `cycletls` (Chrome JA3 spoofing) — still failed

The DoorDash deep-link button in `components/OrderButtons.tsx` is set to
render unconditionally (always shown, regardless of verification) so users
can still click through to DoorDash's search page. `isOnDoorDash` is no
longer called from `app/api/delivery-check/route.ts`; the scraper code
itself has been removed. Restore from git history if you want to try again
with a paid web-unlocker service like Bright Data.
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
