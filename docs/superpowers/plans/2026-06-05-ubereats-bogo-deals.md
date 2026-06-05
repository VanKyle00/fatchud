# UberEats BOGO & Free-Item Deals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show nearby restaurants with a current Buy-One-Get-One-Free or free-item deal on UberEats, in a dedicated "Deals" tab inside the existing app.

**Architecture:** A pure, unit-tested classification core (`lib/deals.ts`) turns raw UberEats offer strings into typed `Deal`s. A network function (`getUberEatsDeals` in `lib/ubereats.ts`) reuses the existing feed call, drills the storefront only when the feed flags offers, and caches results. A new `POST /api/deals` fans this out per restaurant, independent of the existing availability path. The UI gains a "Nearby / Deals" in-panel tab toggle that lazily fetches deals.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, `undici` (existing). Tests run via `npx tsx --test` using Node's built-in test runner — no test framework added to `package.json`.

**Design deviation from spec (intentional):** The pure `classifyOffer` + extraction helpers live in a new `lib/deals.ts` (not inside `lib/ubereats.ts`) so the testable core imports no network deps. `getUberEatsDeals` stays in `lib/ubereats.ts` and imports from `lib/deals.ts`. This is the only deviation.

---

## File Structure

- **Create `lib/deals.ts`** — `Deal` type, `classifyOffer` (pure), `collectStrings` (pure), `extractDeals` (pure). The testable core. No imports.
- **Create `lib/deals.test.ts`** — unit tests for the pure functions, run with `npx tsx --test`.
- **Modify `lib/ubereats.ts`** — extend `UberFeedItem` type; add `fetchStorefront` + `getUberEatsDeals`. Existing `isOnUberEats` untouched.
- **Create `app/api/deals/route.ts`** — `POST` endpoint fanning out `getUberEatsDeals`.
- **Create `components/DealsPanel.tsx`** — renders deal-bearing restaurants.
- **Modify `components/RestaurantPanel.tsx`** — add Nearby/Deals tab toggle; render `DealsPanel` in deals view.
- **Modify `app/page.tsx`** — own `view`/`deals`/`dealsLoading` state; lazy-fetch `/api/deals`.

---

## Task 1: Pure offer classifier (`lib/deals.ts`)

**Files:**
- Create: `lib/deals.ts`
- Test: `lib/deals.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/deals.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOffer } from "./deals";

test("classifyOffer: BOGO phrasings", () => {
  assert.equal(classifyOffer("Buy 1 Get 1 Free and more"), "bogo");
  assert.equal(classifyOffer("Buy One Get One Free"), "bogo");
  assert.equal(classifyOffer("BOGO"), "bogo");
  assert.equal(classifyOffer("2 for 1"), "bogo");
});

test("classifyOffer: free-item phrasings", () => {
  assert.equal(classifyOffer("Free Beef Franks (12 oz)"), "free_item");
  assert.equal(classifyOffer("Free Item"), "free_item");
});

test("classifyOffer: excluded deals return null", () => {
  assert.equal(classifyOffer("10% off"), null);
  assert.equal(classifyOffer("$5 off on $40+"), null);
  assert.equal(classifyOffer("Free delivery"), null);
  assert.equal(classifyOffer("$0 Delivery Fee"), null);
  assert.equal(classifyOffer("Items on sale"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/deals.test.ts`
Expected: FAIL — cannot find module `./deals` / `classifyOffer is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/deals.ts`:

```ts
// Pure offer-text classification for the deals feature. No network/IO here so
// it stays trivially unit-testable. UberEats network code lives in lib/ubereats.ts.

export type Deal = { kind: "bogo" | "free_item"; text: string };

// BOGO: "buy one get one free", "buy 1 get 1 free", "2 for 1", literal "BOGO".
const BOGO_RE = [
  /buy\s*(one|1)\b.*\b(get|,)\b.*\b(one|1)\b.*\bfree\b/i,
  /\b2\s*for\s*1\b/i,
  /\bbogo\b/i,
];
// Free item: contains "free", but NOT free delivery/shipping/fee (those are excluded).
const FREE_ITEM_RE = /\bfree\b/i;
const FREE_EXCLUDE_RE = /\bfree\s*(delivery|shipping|fee)\b/i;

export function classifyOffer(text: string): Deal["kind"] | null {
  const t = text.trim();
  if (BOGO_RE.some((re) => re.test(t))) return "bogo";
  if (FREE_ITEM_RE.test(t) && !FREE_EXCLUDE_RE.test(t)) return "free_item";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/deals.test.ts`
Expected: PASS — 3 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/deals.ts lib/deals.test.ts
git commit -m "feat(deals): pure offer classifier"
```

---

## Task 2: Storefront deal extraction (`lib/deals.ts`)

**Files:**
- Modify: `lib/deals.ts`
- Test: `lib/deals.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `lib/deals.test.ts`:

```ts
import { extractDeals, collectStrings } from "./deals";

test("collectStrings: gathers all nested string values", () => {
  const got = collectStrings({ a: "x", b: ["y", { c: "z" }], d: 5 });
  assert.deepEqual(got.sort(), ["x", "y", "z"]);
});

test("extractDeals: keeps BOGO + free-item, drops the rest, dedupes, strips HTML", () => {
  const storeJson = {
    title: "Buy 1 Get 1 Free and more",
    items: [
      "Free Beef Franks (12 oz) <img src=\"x\">",
      "10% off",
      "Free delivery",
      "Buy 1 Get 1 Free and more",
      "This is a very long terms and conditions sentence about a free item reward redeemable later.",
    ],
  };
  const deals = extractDeals(storeJson);
  assert.deepEqual(deals, [
    { kind: "bogo", text: "Buy 1 Get 1 Free and more" },
    { kind: "free_item", text: "Free Beef Franks (12 oz)" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/deals.test.ts`
Expected: FAIL — `extractDeals`/`collectStrings` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/deals.ts`:

```ts
// Recursively gather every string value from an arbitrary JSON-like value.
// UberEats nests offer text deep and inconsistently, so we scan all strings
// rather than hardcode a field path (resilient, matches the repo's other scrapers).
export function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const v of node) collectStrings(v, out);
  else if (node && typeof node === "object")
    for (const v of Object.values(node)) collectStrings(v, out);
  return out;
}

function sanitize(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pull BOGO/free-item deals out of a storefront JSON payload. Short strings only
// (3..50 chars) so we match offer titles, not legal/disclaimer paragraphs.
export function extractDeals(storeJson: unknown): Deal[] {
  const deals: Deal[] = [];
  const seen = new Set<string>();
  for (const raw of collectStrings(storeJson)) {
    const text = sanitize(raw);
    if (text.length < 3 || text.length > 50) continue;
    const kind = classifyOffer(text);
    if (!kind || seen.has(text)) continue;
    seen.add(text);
    deals.push({ kind, text });
  }
  return deals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/deals.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add lib/deals.ts lib/deals.test.ts
git commit -m "feat(deals): storefront deal extraction"
```

---

## Task 3: UberEats deals fetcher (`lib/ubereats.ts`)

**Files:**
- Modify: `lib/ubereats.ts` (extend `UberFeedItem`; add `fetchStorefront` + `getUberEatsDeals`)

No unit test — this is network code. Verified by the live smoke test in Task 7.

- [ ] **Step 1: Extend the feed item type**

In `lib/ubereats.ts`, replace the `UberFeedItem` type (currently lines 27-32):

```ts
type UberFeedItem = {
  store?: {
    storeUuid?: string;
    title?: { text?: string };
    mapMarker?: { latitude?: number; longitude?: number };
    signposts?: unknown;
  };
};
```

- [ ] **Step 2: Add the storefront fetch + deals function**

Add to the imports near the top of `lib/ubereats.ts` (next to the existing `import { readCache, writeCache } from "@/lib/cache";`):

```ts
import { collectStrings, extractDeals, type Deal } from "@/lib/deals";
```

Append to the end of `lib/ubereats.ts`:

```ts
const DEALS_TTL_SECONDS = 60 * 60 * 12; // 12h — promos rotate faster than availability

const STORE_URL = "https://www.ubereats.com/api/getStoreV1?localeCode=us";

async function fetchStorefront(storeUuid: string): Promise<unknown> {
  const agent = getProxyAgent();
  const init = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": "x",
      "User-Agent": UA,
      Accept: "application/json",
    },
    body: JSON.stringify({ storeUuid }),
    ...(agent && { dispatcher: agent }),
  } as Parameters<typeof fetch>[1];
  const res = await fetch(STORE_URL, init);
  if (!res.ok) throw new Error(`ubereats store ${res.status}`);
  return res.json();
}

export async function getUberEatsDeals(name: string, lat: number, lng: number): Promise<Deal[]> {
  const cacheKey = `scraper:ubereats-deals:${normalizeName(name)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
  const cached = await readCache<Deal[]>(cacheKey);
  if (cached !== null) return cached;

  let deals: Deal[] = [];
  try {
    const items = await searchUberEats(name, lat, lng);
    const target = normalizeName(name);
    const match = items.find((item) => {
      const title = item.store?.title?.text;
      const m = item.store?.mapMarker;
      if (!title || typeof m?.latitude !== "number" || typeof m.longitude !== "number") return false;
      if (haversineMeters(lat, lng, m.latitude, m.longitude) > MATCH_RADIUS_M) return false;
      const candidate = normalizeName(title);
      return candidate.includes(target) || target.includes(candidate);
    });

    const uuid = match?.store?.storeUuid;
    // Cost gate: only fetch the ~280KB storefront when the feed already shows an
    // offer signpost for this store. Offer-free stores cost zero extra requests.
    const hasOfferSignal = collectStrings(match?.store?.signposts).length > 0;
    if (uuid && hasOfferSignal) {
      const store = await fetchStorefront(uuid);
      deals = extractDeals(store);
    }
  } catch (err) {
    console.warn(`[ubereats deals] "${name}" failed:`, err instanceof Error ? err.message : err);
    deals = [];
  }

  await writeCache(cacheKey, deals, DEALS_TTL_SECONDS);
  return deals;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/ubereats.ts
git commit -m "feat(deals): getUberEatsDeals with storefront drill + 12h cache"
```

---

## Task 4: Deals API route (`app/api/deals/route.ts`)

**Files:**
- Create: `app/api/deals/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/deals/route.ts` (mirrors `app/api/delivery-check/route.ts`):

```ts
import { getUberEatsDeals } from "@/lib/ubereats";
import type { Deal } from "@/lib/deals";

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
        return [r.id, [] as Deal[]] as const;
      }
      const deals = await getUberEatsDeals(r.name, r.lat, r.lng);
      return [r.id, deals] as const;
    }),
  );

  const deals: Record<string, Deal[]> = {};
  for (const [id, value] of entries) deals[id] = value;
  return Response.json({ deals });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/deals/route.ts
git commit -m "feat(deals): POST /api/deals endpoint"
```

---

## Task 5: Deals panel component (`components/DealsPanel.tsx`)

**Files:**
- Create: `components/DealsPanel.tsx`

- [ ] **Step 1: Write the component**

Create `components/DealsPanel.tsx`:

```tsx
"use client";

import type { Restaurant } from "@/lib/types";
import type { Deal } from "@/lib/deals";
import { orderUrl } from "@/lib/deep-links";

type Props = {
  restaurants: Restaurant[];
  deals: Record<string, Deal[]>;
  loading: boolean;
  onSelect: (id: string) => void;
};

const KIND_LABEL: Record<Deal["kind"], string> = {
  bogo: "BOGO",
  free_item: "Free item",
};

export function DealsPanel({ restaurants, deals, loading, onSelect }: Props) {
  const withDeals = restaurants.filter((r) => (deals[r.id]?.length ?? 0) > 0);

  if (loading) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">Finding deals…</p>
    );
  }
  if (withDeals.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No BOGO or free-item deals nearby right now.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {withDeals.map((r) => (
        <div
          key={r.id}
          className="flex flex-col gap-1.5 rounded-2xl border border-black/5 dark:border-white/10 p-3"
        >
          <button
            type="button"
            onClick={() => onSelect(r.id)}
            className="flex w-full items-baseline justify-between gap-2 text-left"
          >
            <span className="truncate font-medium">{r.name}</span>
            {r.rating !== null && (
              <span className="shrink-0 text-sm tabular-nums">★ {r.rating.toFixed(1)}</span>
            )}
          </button>
          <div className="flex flex-wrap gap-1">
            {deals[r.id].map((d, i) => (
              <span
                key={i}
                className="rounded-full bg-green-600/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400"
              >
                {KIND_LABEL[d.kind]}: {d.text}
              </span>
            ))}
          </div>
          <a
            href={orderUrl("ubereats", r.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 w-full rounded-full bg-green-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition hover:bg-green-700"
          >
            Order on UberEats
          </a>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/DealsPanel.tsx
git commit -m "feat(deals): DealsPanel component"
```

---

## Task 6: Wire the Nearby/Deals tab toggle

**Files:**
- Modify: `components/RestaurantPanel.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Add deals props + tab toggle to `RestaurantPanel`**

In `components/RestaurantPanel.tsx`, add imports near the existing component imports:

```tsx
import type { Deal } from "@/lib/deals";
import { DealsPanel } from "./DealsPanel";
```

Add these fields to the `Props` type (after `onToggleCollapsed?: () => void;`):

```tsx
  view: "nearby" | "deals";
  onViewChange: (next: "nearby" | "deals") => void;
  deals: Record<string, Deal[]>;
  dealsLoading: boolean;
```

Destructure the new props in the function signature (add to the existing param list):

```tsx
  view,
  onViewChange,
  deals,
  dealsLoading,
```

- [ ] **Step 2: Replace the header title block with a segmented toggle**

In `components/RestaurantPanel.tsx`, replace the title block (the `<div className="flex items-baseline gap-2">…</div>` containing `<h2>Nearby</h2>` and the count span) with:

```tsx
        <div className="flex items-center gap-1 rounded-full border border-black/5 dark:border-white/10 p-0.5 text-sm">
          <button
            type="button"
            onClick={() => onViewChange("nearby")}
            className={`rounded-full px-3 py-1 font-medium transition ${
              view === "nearby"
                ? "bg-black/[.06] dark:bg-white/10"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Nearby{" "}
            <span className="tabular-nums">
              {loading && view === "nearby" ? "…" : `${filtered.length}/${restaurants.length}`}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onViewChange("deals")}
            className={`rounded-full px-3 py-1 font-medium transition ${
              view === "deals"
                ? "bg-black/[.06] dark:bg-white/10"
                : "text-zinc-500 dark:text-zinc-400"
            }`}
          >
            Deals
          </button>
        </div>
```

- [ ] **Step 3: Render the FilterBar only in nearby view, and swap the body**

In `components/RestaurantPanel.tsx`, change the FilterBar guard from:

```tsx
      {!collapsed && restaurants.length > 0 && (
        <FilterBar filter={filter} cuisines={cuisines} onChange={onFilterChange} />
      )}
```

to:

```tsx
      {!collapsed && view === "nearby" && restaurants.length > 0 && (
        <FilterBar filter={filter} cuisines={cuisines} onChange={onFilterChange} />
      )}
```

Then wrap the existing scrolling list `<div className="flex min-h-0 flex-1 ...">…</div>` so it renders only in nearby view, and render `DealsPanel` in deals view. Replace the existing body block:

```tsx
      <div
        className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ${collapsed ? "hidden" : ""}`}
      >
        {filtered.map((r) => (
          /* …existing card mapping unchanged… */
        ))}
        {!loading && filtered.length === 0 && restaurants.length > 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No restaurants match your filters.
          </p>
        )}
        {!loading && restaurants.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter an address to see restaurants.
          </p>
        )}
      </div>
```

with:

```tsx
      <div className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto ${collapsed ? "hidden" : ""}`}>
        {view === "deals" ? (
          <DealsPanel
            restaurants={restaurants}
            deals={deals}
            loading={dealsLoading}
            onSelect={onSelect}
          />
        ) : (
          <>
            {filtered.map((r) => (
              <div
                key={r.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(r.id, el);
                  else cardRefs.current.delete(r.id);
                }}
              >
                <RestaurantCard
                  restaurant={r}
                  selected={r.id === selectedId}
                  visited={visited.has(r.id)}
                  availability={availability[r.id] ?? EMPTY_AVAILABILITY}
                  onClick={() => onSelect(r.id)}
                  onToggleVisited={() => onToggleVisited(r.id)}
                />
              </div>
            ))}
            {!loading && filtered.length === 0 && restaurants.length > 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                No restaurants match your filters.
              </p>
            )}
            {!loading && restaurants.length === 0 && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Enter an address to see restaurants.
              </p>
            )}
          </>
        )}
      </div>
```

- [ ] **Step 4: Add deals state + lazy fetch in `app/page.tsx`**

In `app/page.tsx`, add imports:

```tsx
import type { Deal } from "@/lib/deals";
```

Add state near the other `useState` declarations (after the `error` state, line ~24):

```tsx
  const [view, setView] = useState<"nearby" | "deals">("nearby");
  const [deals, setDeals] = useState<Record<string, Deal[]>>({});
  const [dealsLoading, setDealsLoading] = useState(false);
```

In the restaurants-fetch `.then((data) => { … })` block, reset deals alongside availability. Change:

```tsx
        setRestaurants(data.restaurants);
        setAvailability({});
```

to:

```tsx
        setRestaurants(data.restaurants);
        setAvailability({});
        setDeals({});
```

Add a lazy deals-fetch effect after the existing `delivery-check` effect (after line ~135):

```tsx
  useEffect(() => {
    if (view !== "deals") return;
    if (available.length === 0) return;
    if (Object.keys(deals).length > 0) return; // already fetched for this restaurant set
    let cancelled = false;
    setDealsLoading(true);
    fetch("/api/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurants: available.map((r) => ({
          id: r.id,
          name: r.name,
          lat: r.location.lat,
          lng: r.location.lng,
        })),
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`deals ${res.status}`);
        return (await res.json()) as { deals: Record<string, Deal[]> };
      })
      .then((data) => {
        if (!cancelled) setDeals(data.deals ?? {});
      })
      .catch(() => {
        /* leave deals empty; panel shows empty state */
      })
      .finally(() => {
        if (!cancelled) setDealsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, available, deals]);
```

- [ ] **Step 5: Pass the new props to both `RestaurantPanel` instances**

In `app/page.tsx`, add these four props to BOTH `<RestaurantPanel … />` usages (desktop ~line 172 and mobile ~line 194):

```tsx
          view={view}
          onViewChange={setView}
          deals={deals}
          dealsLoading={dealsLoading}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors, no lint errors.

- [ ] **Step 7: Commit**

```bash
git add components/RestaurantPanel.tsx app/page.tsx
git commit -m "feat(deals): Nearby/Deals tab toggle with lazy fetch"
```

---

## Task 7: Live smoke test & verification

**Files:** none (manual verification)

- [ ] **Step 1: Re-run all unit tests**

Run: `npx tsx --test lib/deals.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 2: Typecheck + lint the whole project**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Smoke-test the endpoint against a real, deal-likely store**

Start the dev server (`npm run dev`), then in another shell hit `/api/deals` with a chain known to run BOGO/free-item promos in a dense area. Run from the residential machine (UberEats geolocates by IP):

```bash
curl -s -X POST http://localhost:3000/api/deals \
  -H 'Content-Type: application/json' \
  -d '{"restaurants":[{"id":"t1","name":"Wendys","lat":40.7580,"lng":-73.9857}]}' | python3 -m json.tool
```

Expected: a `{ "deals": { "t1": [...] } }` response. The array may be empty if that store has no current BOGO/free-item promo — that is a valid result, not a failure. Try 2-3 different chains (e.g. "Wendys", "Wingstop", "Baskin Robbins") to confirm at least one returns a `bogo` or `free_item` entry, proving the storefront drill + classifier work end-to-end on live data.

- [ ] **Step 4: Smoke-test the UI**

Open `http://localhost:3000`, let restaurants load, click the **Deals** tab. Expected: "Finding deals…" then either a list of restaurants with BOGO/Free-item badges and an "Order on UberEats" button, or the "No BOGO or free-item deals nearby right now." empty state. Switching back to **Nearby** shows the original list unchanged.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(deals): live smoke verification"
```

---

## Self-Review

**Spec coverage:**
- Deal kinds bogo + free_item only → Task 1 (`classifyOffer`), Task 2 (`extractDeals` filters). ✓
- UberEats feed reuse + storefront drill + cost gate → Task 3. ✓
- Separate `/api/deals` endpoint → Task 4. ✓
- `DealsPanel` + in-panel tab toggle, lazy fetch → Tasks 5, 6. ✓
- 12h cache, silent-degrade → Task 3. ✓
- Pure testable classifier, no new framework, live smoke test → Tasks 1-2 (unit), Task 7 (smoke). ✓
- DoorDash/Grubhub excluded → not in any task (correct; DoorDash is the next phase). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The one `/* …existing card mapping unchanged… */` is inside a "replace FROM" block (showing what to find), and the full replacement is given immediately below it. ✓

**Type consistency:** `Deal` / `Deal["kind"]` (`"bogo" | "free_item"`), `getUberEatsDeals(name,lat,lng): Promise<Deal[]>`, `Record<string, Deal[]>`, and the `view: "nearby" | "deals"` union are used identically across `lib/deals.ts`, `lib/ubereats.ts`, `app/api/deals/route.ts`, `components/DealsPanel.tsx`, `components/RestaurantPanel.tsx`, and `app/page.tsx`. ✓
