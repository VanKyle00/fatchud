# DoorDash Availability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the working DoorDash scraper to populate verified availability — surface DoorDash-exclusive restaurants and make the DoorDash button accurate (tri-state) — without slowing the core map load.

**Architecture:** `availability.doordash` becomes tri-state `"yes"|"no"|"unknown"`. A consolidated `getDoorDashStoreInfo` (one fetch/cache per restaurant) feeds both availability and the deals tab. A new lazy `POST /api/doordash-check` runs off the critical path; `page.tsx` merges its results in progressively. `delivery-check` stops touching DoorDash.

**Tech Stack:** Next.js 16, TypeScript, cycletls (existing). Tests via `npx tsx --test`. Typecheck `./node_modules/.bin/tsc --noEmit`; build `./node_modules/.bin/next build`.

**Branching:** Stacks on `feat/doordash-deals` (PR #2). Branch this work off `feat/doordash-deals`.

---

## File Structure

- **Modify `lib/types.ts`** — add `DoorDashState` + `DeliveryAvailability` (canonical home).
- **Modify `app/api/delivery-check/route.ts`** — use shared type; return `doordash:"unknown"`.
- **Modify `components/OrderButtons.tsx`** — tri-state show logic, drop `ALWAYS_SHOW`.
- **Modify `components/RestaurantCard.tsx`** + **`components/RestaurantPanel.tsx`** — availability prop type.
- **Modify `app/page.tsx`** — state type, lazy doordash-check pass, merged availability + filter.
- **Modify `lib/doordash.ts`** — `matchStore` (pure), `getDoorDashStoreInfo` (consolidated), `doordashState`; rewrite `getDoorDashDeals`.
- **Modify `lib/doordash.test.ts`** — unit-test `matchStore`.
- **Create `app/api/doordash-check/route.ts`** — lazy availability endpoint.
- **Modify `next.config.ts`** — bundle cycletls for the new route too.
- **Modify `README.md`, `SCRAPER_NOTES.md`** — correct the stale DoorDash guidance.

---

## Task 1: Tri-state availability type across the app

This is one atomic, behavior-preserving refactor: after it, `doordash` is `"unknown"` everywhere (button shows like today; list unchanged), but the types are ready for the real check.

**Files:** `lib/types.ts`, `app/api/delivery-check/route.ts`, `components/OrderButtons.tsx`, `components/RestaurantCard.tsx`, `components/RestaurantPanel.tsx`, `app/page.tsx`

- [ ] **Step 1: Add the shared types**

Append to `lib/types.ts`:

```ts
export type DoorDashState = "yes" | "no" | "unknown";

export type DeliveryAvailability = {
  grubhub: boolean;
  ubereats: boolean;
  doordash: DoorDashState;
};
```

- [ ] **Step 2: `delivery-check` uses the shared type and returns "unknown"**

In `app/api/delivery-check/route.ts`, replace the local type declaration:

```ts
export type DeliveryAvailability = { grubhub: boolean; ubereats: boolean; doordash: boolean };
```

with an import at the top of the file (next to the other imports):

```ts
import type { DeliveryAvailability } from "@/lib/types";
```

Then replace the invalid-item return:

```ts
        return [r.id, { grubhub: false, ubereats: false, doordash: false }] as const;
```

with:

```ts
        return [r.id, { grubhub: false, ubereats: false, doordash: "unknown" }] as const;
```

And replace the valid-item return block (the comment + return):

```ts
      // DoorDash is not verified — Cloudflare blocks every scrape attempt from
      // datacenter IPs even through residential proxies + TLS impersonation.
      // The DoorDash order button still renders unconditionally (best-effort
      // deep link to their search). availability.doordash stays false so it
      // doesn't count toward the "any platform confirmed" filter.
      return [r.id, { grubhub, ubereats, doordash: false }] as const;
```

with:

```ts
      // DoorDash availability is resolved separately and lazily via
      // /api/doordash-check (cycletls). Here it's "unknown" until that pass runs.
      return [r.id, { grubhub, ubereats, doordash: "unknown" }] as const;
```

- [ ] **Step 3: `OrderButtons` tri-state show logic**

Replace the whole body of `components/OrderButtons.tsx` with:

```tsx
"use client";

import { PLATFORMS, PLATFORM_LABELS, type Platform, orderUrl } from "@/lib/deep-links";
import type { DeliveryAvailability } from "@/lib/types";

type Props = {
  name: string;
  availability: DeliveryAvailability;
};

const PLATFORM_BG: Record<Platform, string> = {
  doordash: "bg-red-500 hover:bg-red-600",
  ubereats: "bg-green-600 hover:bg-green-700",
  grubhub: "bg-orange-500 hover:bg-orange-600",
};

// Grubhub/UberEats render only when confirmed. DoorDash renders unless it was
// confirmed absent ("no") — so a successful check that finds it missing hides
// the button, while an unverified/blocked check keeps the best-effort link.
function isVisible(p: Platform, a: DeliveryAvailability): boolean {
  if (p === "doordash") return a.doordash !== "no";
  if (p === "ubereats") return a.ubereats;
  return a.grubhub;
}

export function OrderButtons({ name, availability }: Props) {
  const visible = PLATFORMS.filter((p) => isVisible(p, availability));
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 flex gap-1.5">
      {visible.map((p) => (
        <a
          key={p}
          href={orderUrl(p, name)}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex-1 rounded-full px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition ${PLATFORM_BG[p]}`}
        >
          {PLATFORM_LABELS[p]}
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `RestaurantCard` availability prop type**

In `components/RestaurantCard.tsx`, replace the import line:

```tsx
import type { Platform } from "@/lib/deep-links";
```

with:

```tsx
import type { DeliveryAvailability } from "@/lib/types";
```

and replace the prop type:

```tsx
  availability: Record<Platform, boolean>;
```

with:

```tsx
  availability: DeliveryAvailability;
```

- [ ] **Step 5: `RestaurantPanel` availability prop + empty value**

In `components/RestaurantPanel.tsx`, change the import (the file imports `Platform`):

```tsx
import type { Platform } from "@/lib/deep-links";
```

to:

```tsx
import type { Platform } from "@/lib/deep-links";
import type { DeliveryAvailability } from "@/lib/types";
```

Replace the prop type:

```tsx
  availability: Record<string, Record<Platform, boolean>>;
```

with:

```tsx
  availability: Record<string, DeliveryAvailability>;
```

Replace `EMPTY_AVAILABILITY`:

```tsx
const EMPTY_AVAILABILITY: Record<Platform, boolean> = {
  doordash: false,
  ubereats: false,
  grubhub: false,
};
```

with:

```tsx
const EMPTY_AVAILABILITY: DeliveryAvailability = {
  grubhub: false,
  ubereats: false,
  doordash: "unknown",
};
```

(If `Platform` is now unused in `RestaurantPanel.tsx` after this, leave the import — `EMPTY_AVAILABILITY`'s old `Record<Platform, …>` is gone but `Platform` may still be referenced elsewhere in the file; if tsc flags it as unused in Step 7, remove it then.)

- [ ] **Step 6: `page.tsx` state type + filter**

In `app/page.tsx`, add to the type imports:

```tsx
import type { FilterState, GeocodeResult, LatLng, Restaurant } from "@/lib/types";
```

becomes:

```tsx
import type { DeliveryAvailability, FilterState, GeocodeResult, LatLng, Restaurant } from "@/lib/types";
```

Replace the availability state declaration:

```tsx
  const [availability, setAvailability] = useState<Record<string, { grubhub: boolean; ubereats: boolean; doordash: boolean }>>({});
```

with:

```tsx
  const [availability, setAvailability] = useState<Record<string, DeliveryAvailability>>({});
```

Replace the filter predicate:

```tsx
      return a && (a.grubhub || a.ubereats || a.doordash);
```

with:

```tsx
      return a && (a.grubhub || a.ubereats || a.doordash === "yes");
```

Replace the delivery-check response type annotation:

```tsx
        return (await res.json()) as {
          availability: Record<string, { grubhub: boolean; ubereats: boolean; doordash: boolean }>;
        };
```

with:

```tsx
        return (await res.json()) as {
          availability: Record<string, DeliveryAvailability>;
        };
```

- [ ] **Step 7: Typecheck and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0. (If `Platform` is unused in `RestaurantPanel.tsx`, remove that import line and re-run.)

```bash
git add lib/types.ts app/api/delivery-check/route.ts components/OrderButtons.tsx components/RestaurantCard.tsx components/RestaurantPanel.tsx app/page.tsx
git commit -m "refactor(availability): tri-state DoorDash availability type"
```

---

## Task 2: Consolidated DoorDash store info

**Files:** `lib/doordash.ts`, `lib/doordash.test.ts`

- [ ] **Step 1: Write the failing test for `matchStore`**

Append to `lib/doordash.test.ts`:

```ts
import { matchStore } from "./doordash";

const STORES = [
  { name: "Joe's Pizza", lat: 40.7300, lng: -74.0000, promotionTitle: "$5 off on $35+" },
  { name: "No Promo Pizza", lat: 40.7301, lng: -74.0001, promotionTitle: "" },
  { name: "Far Away Pizza", lat: 41.0000, lng: -75.0000, promotionTitle: "20% off" },
];

test("matchStore: name+coord match returns matched + promo", () => {
  assert.deepEqual(matchStore(STORES, "Joe's Pizza", 40.73, -74.0), {
    matched: true,
    promotionTitle: "$5 off on $35+",
  });
});

test("matchStore: matched store with no promo", () => {
  assert.deepEqual(matchStore(STORES, "No Promo Pizza", 40.7301, -74.0001), {
    matched: true,
    promotionTitle: "",
  });
});

test("matchStore: name mismatch and out-of-radius both return not matched", () => {
  assert.deepEqual(matchStore(STORES, "Nonexistent Grill", 40.73, -74.0), {
    matched: false,
    promotionTitle: "",
  });
  // "Far Away Pizza" matches by name but is ~140km away -> rejected by radius
  assert.deepEqual(matchStore(STORES, "Far Away Pizza", 40.73, -74.0), {
    matched: false,
    promotionTitle: "",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/doordash.test.ts`
Expected: FAIL — `matchStore` is not exported.

- [ ] **Step 3: Add `matchStore`, `getDoorDashStoreInfo`, `doordashState`; rewrite `getDoorDashDeals`**

In `lib/doordash.ts`, add the `DoorDashState` import next to the existing `import type { Deal } from "@/lib/deals";`:

```ts
import type { DoorDashState } from "@/lib/types";
```

Add `matchStore` right after the `haversineMeters` function:

```ts
// Pure: find the store matching this restaurant by normalized name + <150m.
export function matchStore(
  stores: DoorDashStore[],
  name: string,
  lat: number,
  lng: number,
): { matched: boolean; promotionTitle: string } {
  const target = normalizeName(name);
  for (const s of stores) {
    if (haversineMeters(lat, lng, s.lat, s.lng) > MATCH_RADIUS_M) continue;
    const candidate = normalizeName(s.name);
    if (candidate.includes(target) || target.includes(candidate)) {
      return { matched: true, promotionTitle: s.promotionTitle };
    }
  }
  return { matched: false, promotionTitle: "" };
}
```

Then replace the entire `getDoorDashDeals` function:

```ts
export async function getDoorDashDeals(name: string, lat: number, lng: number): Promise<Deal[]> {
  const cacheKey = `scraper:doordash-deals:${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const cached = await readCache<Deal[]>(cacheKey);
  if (cached !== null) return cached;

  let deals: Deal[] = [];
  try {
    const html = await fetchSearchHtml(name, lat, lng);
    const stores = parseDoorDashStores(html);
    const target = normalizeName(name);
    for (const s of stores) {
      if (!s.promotionTitle) continue;
      if (haversineMeters(lat, lng, s.lat, s.lng) > MATCH_RADIUS_M) continue;
      const candidate = normalizeName(s.name);
      if (candidate.includes(target) || target.includes(candidate)) {
        deals = [{ kind: "discount", text: s.promotionTitle, platform: "doordash" }];
        break;
      }
    }
  } catch (err) {
    console.warn(`[doordash deals] "${name}" failed:`, err instanceof Error ? err.message : err);
    deals = [];
  }

  await writeCache(cacheKey, deals, TTL_SECONDS);
  return deals;
}
```

with the consolidated trio:

```ts
// One fetch+parse+match per restaurant, cached. Both availability and deals
// derive from this — DoorDash is hit at most once per restaurant. Throws on
// fetch error so callers can tell "blocked/errored" from "found nothing".
export async function getDoorDashStoreInfo(
  name: string,
  lat: number,
  lng: number,
): Promise<{ matched: boolean; promotionTitle: string }> {
  const cacheKey = `scraper:doordash:${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const cached = await readCache<{ matched: boolean; promotionTitle: string }>(cacheKey);
  if (cached !== null) return cached;

  const html = await fetchSearchHtml(name, lat, lng);
  const stores = parseDoorDashStores(html);
  const info = matchStore(stores, name, lat, lng);
  await writeCache(cacheKey, info, TTL_SECONDS);
  return info;
}

export async function getDoorDashDeals(name: string, lat: number, lng: number): Promise<Deal[]> {
  try {
    const { matched, promotionTitle } = await getDoorDashStoreInfo(name, lat, lng);
    if (matched && promotionTitle) {
      return [{ kind: "discount", text: promotionTitle, platform: "doordash" }];
    }
    return [];
  } catch (err) {
    console.warn(`[doordash deals] "${name}" failed:`, err instanceof Error ? err.message : err);
    return [];
  }
}

export async function doordashState(name: string, lat: number, lng: number): Promise<DoorDashState> {
  try {
    const { matched } = await getDoorDashStoreInfo(name, lat, lng);
    return matched ? "yes" : "no";
  } catch (err) {
    console.warn(`[doordash availability] "${name}" failed:`, err instanceof Error ? err.message : err);
    return "unknown";
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test lib/doordash.test.ts`
Expected: PASS — 5 tests (2 parse + 3 match), 0 failures.

- [ ] **Step 5: Typecheck and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

```bash
git add lib/doordash.ts lib/doordash.test.ts
git commit -m "feat(doordash): consolidated getDoorDashStoreInfo feeding availability + deals"
```

---

## Task 3: Lazy availability endpoint

**Files:** `app/api/doordash-check/route.ts` (create), `next.config.ts`

- [ ] **Step 1: Create the route**

Create `app/api/doordash-check/route.ts`:

```ts
import { doordashState } from "@/lib/doordash";
import type { DoorDashState } from "@/lib/types";

type Item = { id: string; name: string; lat: number; lng: number };
type Body = { restaurants?: Item[] };

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.restaurants)) {
    return Response.json({ error: "restaurants required" }, { status: 400 });
  }

  const entries = await Promise.all(
    body.restaurants.map(async (r) => {
      if (
        typeof r.id !== "string" ||
        typeof r.name !== "string" ||
        typeof r.lat !== "number" ||
        typeof r.lng !== "number"
      ) {
        return [r.id, "unknown" as DoorDashState] as const;
      }
      return [r.id, await doordashState(r.name, r.lat, r.lng)] as const;
    }),
  );

  const doordash: Record<string, DoorDashState> = {};
  for (const [id, value] of entries) doordash[id] = value;
  return Response.json({ doordash });
}
```

- [ ] **Step 2: Bundle cycletls for the new route**

In `next.config.ts`, this route also uses cycletls, so add it to the tracing config. Replace:

```ts
  outputFileTracingIncludes: {
    "/api/deals": ["./node_modules/cycletls/dist/**"],
  },
  outputFileTracingExcludes: {
    "/api/deals": [
      "./node_modules/cycletls/dist/index-arm",
      "./node_modules/cycletls/dist/index-arm64",
      "./node_modules/cycletls/dist/index-freebsd",
      "./node_modules/cycletls/dist/index-mac",
      "./node_modules/cycletls/dist/index-mac-arm64",
      "./node_modules/cycletls/dist/index.exe",
    ],
  },
```

with:

```ts
  outputFileTracingIncludes: {
    "/api/deals": ["./node_modules/cycletls/dist/**"],
    "/api/doordash-check": ["./node_modules/cycletls/dist/**"],
  },
  outputFileTracingExcludes: {
    "/api/deals": [
      "./node_modules/cycletls/dist/index-arm",
      "./node_modules/cycletls/dist/index-arm64",
      "./node_modules/cycletls/dist/index-freebsd",
      "./node_modules/cycletls/dist/index-mac",
      "./node_modules/cycletls/dist/index-mac-arm64",
      "./node_modules/cycletls/dist/index.exe",
    ],
    "/api/doordash-check": [
      "./node_modules/cycletls/dist/index-arm",
      "./node_modules/cycletls/dist/index-arm64",
      "./node_modules/cycletls/dist/index-freebsd",
      "./node_modules/cycletls/dist/index-mac",
      "./node_modules/cycletls/dist/index-mac-arm64",
      "./node_modules/cycletls/dist/index.exe",
    ],
  },
```

- [ ] **Step 3: Typecheck and commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

```bash
git add app/api/doordash-check/route.ts next.config.ts
git commit -m "feat(doordash): lazy /api/doordash-check availability endpoint"
```

---

## Task 4: Lazy progressive frontend pass

**Files:** `app/page.tsx`

- [ ] **Step 1: Add the DoorDash status state and reset it on reload**

In `app/page.tsx`, add a state declaration after the `availability` state:

```tsx
  const [doordashStatus, setDoordashStatus] = useState<Record<string, DeliveryAvailability["doordash"]>>({});
```

In the restaurants-fetch `.then` block, reset it alongside the others. Change:

```tsx
        setRestaurants(data.restaurants);
        setAvailability({});
        setDeals({});
```

to:

```tsx
        setRestaurants(data.restaurants);
        setAvailability({});
        setDeals({});
        setDoordashStatus({});
```

- [ ] **Step 2: Merge DoorDash status into availability**

`availabilityMerged` must be declared **before** the `available` memo that reads it (a `useMemo` callback runs during render, so a later-declared const would hit the temporal dead zone). In `app/page.tsx`, insert this immediately **before** the existing `const available = useMemo(...)` line:

```tsx
  const availabilityMerged = useMemo(() => {
    const out: Record<string, DeliveryAvailability> = {};
    for (const id in availability) {
      out[id] = { ...availability[id], doordash: doordashStatus[id] ?? availability[id].doordash };
    }
    return out;
  }, [availability, doordashStatus]);
```

Then change the `available` memo to read the merged value. Replace:

```tsx
    const confirmed = candidates.filter((r) => {
      const a = availability[r.id];
      return a && (a.grubhub || a.ubereats || a.doordash === "yes");
    });
```

with:

```tsx
    const confirmed = candidates.filter((r) => {
      const a = availabilityMerged[r.id];
      return a && (a.grubhub || a.ubereats || a.doordash === "yes");
    });
```

and add `availabilityMerged` to that memo's dependency array — change the line closing the `available` memo:

```tsx
  }, [restaurants, availability]);
```

to:

```tsx
  }, [restaurants, availabilityMerged]);
```

(Also note: the `allChecked` line inside the `available` memo still reads `availability[r.id] !== undefined` — leave it as `availability`, since "checked" means delivery-check has populated grubhub/ubereats; DoorDash arriving later shouldn't gate it.)

- [ ] **Step 3: Fire the lazy DoorDash check**

In `app/page.tsx`, add this effect right after the existing `delivery-check` effect (the one ending `}, [restaurants]);`):

```tsx
  useEffect(() => {
    if (restaurants.length === 0) return;
    const candidates = restaurants.filter((r) => r.delivery !== false);
    if (candidates.length === 0) return;
    if (Object.keys(doordashStatus).length > 0) return; // already fetched for this set
    let cancelled = false;
    fetch("/api/doordash-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: candidates.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.location.lat,
          lng: r.location.lng,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`doordash-check ${res.status}`);
        return (await res.json()) as { doordash: Record<string, DeliveryAvailability["doordash"]> };
      })
      .then((data) => {
        if (!cancelled) setDoordashStatus(data.doordash ?? {});
      })
      .catch(() => {
        /* leave doordash as "unknown"; buttons still show, list unchanged */
      });
    return () => {
      cancelled = true;
    };
  }, [restaurants, doordashStatus]);
```

- [ ] **Step 4: Pass merged availability to both panels**

In `app/page.tsx`, both `<RestaurantPanel … />` usages pass `availability={availability}`. Change **both** to:

```tsx
          availability={availabilityMerged}
```

- [ ] **Step 5: Typecheck + lint and commit**

Run: `./node_modules/.bin/tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: tsc exit 0. Lint may report the pre-existing `set-state-in-effect` warnings (unchanged baseline); no *new* error types from this task beyond that pattern.

```bash
git add app/page.tsx
git commit -m "feat(doordash): lazy progressive availability pass in page"
```

---

## Task 5: Correct the stale docs

**Files:** `README.md`, `SCRAPER_NOTES.md`

- [ ] **Step 1: Fix the README DoorDash section**

In `README.md`, replace the deploy-warning paragraph:

```markdown
⚠️ Keep DoorDash *disabled* on any branch you intend to deploy. If `isOnDoorDash` is in the fan-out on Vercel, every restaurant returns `false` from that branch of the check, the global `available` filter shrinks accordingly, and the visible restaurant list silently gets worse.
```

with:

```markdown
DoorDash availability is now resolved lazily via `/api/doordash-check` (cycletls Chrome-JA3 transport) and is **tri-state**: `"yes"` (confirmed — counts toward the list), `"no"` (confirmed absent — button hidden), `"unknown"` (blocked/errored — best-effort button still shows, not counted). Because the list filter is OR across platforms, re-enabling DoorDash can only *add* DoorDash-exclusive restaurants, never shrink the list. On a blocked origin (e.g. a Vercel datacenter IP, still unverified) every result is `"unknown"`, which is a no-op versus the old hardcoded behavior — no regression.
```

- [ ] **Step 2: Fix the SCRAPER_NOTES DoorDash deals note**

In `SCRAPER_NOTES.md`, the "DoorDash deals (`lib/doordash.ts`)" section header and first paragraph currently say the file hosts only the deals scraper. Replace:

```markdown
## DoorDash deals (`lib/doordash.ts`) — re-enabled via cycletls

This file now hosts the **deals** scraper (used by `app/api/deals`), separate
from the old *availability* scraper described under "not verified anymore"
below (that one is still removed from `delivery-check`).
```

with:

```markdown
## DoorDash deals + availability (`lib/doordash.ts`) — re-enabled via cycletls

This file hosts both the **deals** scraper (`app/api/deals`) and the **availability**
check (`app/api/doordash-check`). Both go through one `getDoorDashStoreInfo`
(fetch+parse+match, cached once as `scraper:doordash:<key>`), so DoorDash is hit
at most once per restaurant. Availability is **tri-state** (`doordashState`:
`"yes"`/`"no"`/`"unknown"`) and resolved lazily off the critical path; the old
"keep DoorDash disabled / it shrinks the list" guidance no longer applies (the
OR-filter means it can only add restaurants).
```

- [ ] **Step 3: Commit**

```bash
git add README.md SCRAPER_NOTES.md
git commit -m "docs(doordash): correct stale availability guidance"
```

---

## Task 6: Live verification

**Files:** none (manual verification)

- [ ] **Step 1: Unit tests + build**

Run: `npx tsx --test lib/deals.test.ts lib/doordash.test.ts && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/next build 2>&1 | grep -E "Compiled|doordash-check|api/deals|error TS"`
Expected: tests pass (deals 5 + doordash 5 = 10), build clean, `/api/doordash-check` and `/api/deals` both listed as routes.

- [ ] **Step 2: Smoke-test `/api/doordash-check` from this residential machine**

Start `npm run dev`, then:

```bash
curl -s -X POST http://localhost:3000/api/doordash-check \
  -H 'Content-Type: application/json' \
  -d '{"restaurants":[
    {"id":"bleecker","name":"Bleecker Street Pizza","lat":40.732246,"lng":-74.003377},
    {"id":"fake","name":"Zzqx Nonexistent Eatery","lat":40.732246,"lng":-74.003377}
  ]}' | python3 -m json.tool
```

Expected: `bleecker` → `"yes"`, `fake` → `"no"` (real store matches, fake name doesn't at the same coords). A `"unknown"` means the fetch was blocked — retry once.

- [ ] **Step 3: Confirm the deals tab still works (shared fetch)**

```bash
curl -s -X POST http://localhost:3000/api/deals \
  -H 'Content-Type: application/json' \
  -d '{"restaurants":[{"id":"bleecker","name":"Bleecker Street Pizza","lat":40.732246,"lng":-74.003377}]}' | python3 -m json.tool
```

Expected: `bleecker` still returns its `discount` deal — proving `getDoorDashDeals` works through the consolidated `getDoorDashStoreInfo`.

- [ ] **Step 4: Final commit (if verification required fixes)**

```bash
git add -A
git commit -m "test(doordash): availability live verification"
```

---

## Self-Review

**Spec coverage:**
- Tri-state `doordash` type + ripple (page/panel/card/buttons) → Task 1. ✓
- List filter `=== "yes"`, button shows unless `"no"`, `ALWAYS_SHOW` removed → Task 1. ✓
- Consolidated `getDoorDashStoreInfo` feeding availability + deals; `getDoorDashDeals` rewritten; drops its own cache → Task 2. ✓
- `doordashState` tri-state (error→"unknown", not cached) → Task 2 (errors throw out of `getDoorDashStoreInfo` before its cache write; `doordashState` catches). ✓
- New `/api/doordash-check`; `delivery-check` returns `"unknown"` → Tasks 3, 1. ✓
- cycletls bundling for the new route → Task 3. ✓
- Lazy progressive page pass, merged availability, no race (separate `doordashStatus` state merged in a memo) → Task 4. ✓
- Docs corrected → Task 5. ✓
- `matchStore` unit-tested; live smokes → Tasks 2, 6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `DoorDashState = "yes"|"no"|"unknown"` and `DeliveryAvailability = { grubhub:boolean; ubereats:boolean; doordash:DoorDashState }` from `lib/types.ts` used identically in `delivery-check`, `doordash-check`, `OrderButtons`, `RestaurantCard`, `RestaurantPanel`, `page.tsx`, and `lib/doordash.ts` (`doordashState` return). `getDoorDashStoreInfo(name,lat,lng): Promise<{matched;promotionTitle}>` consumed by `getDoorDashDeals` + `doordashState`. `matchStore(stores,name,lat,lng)` matches its test. ✓

**Race check:** `availability` (grubhub/ubereats + doordash:"unknown") and `doordashStatus` are independent states merged read-only in `availabilityMerged`; neither overwrites the other, so delivery-check and doordash-check resolving in any order is safe. ✓
