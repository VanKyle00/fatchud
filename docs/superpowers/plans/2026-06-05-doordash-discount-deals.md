# DoorDash Discount Deals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface nearby restaurants' DoorDash `%`/`$` discount offers in the existing Deals tab, alongside the UberEats BOGO/free-item deals.

**Architecture:** Add a `discount` deal kind and a `platform` field to `Deal`. A new `lib/doordash.ts` fetches DoorDash's search RSC through a shared residential proxy, parses each store's co-located `promotion_title` (pure `parseDoorDashStores`), and matches by name+coords. `/api/deals` runs both platforms in parallel and merges; `DealsPanel` renders per-platform order buttons.

**Tech Stack:** Next.js 16, TypeScript, `undici` (ProxyAgent). Tests via `npx tsx --test` (Node built-in runner) — no framework added. Local tooling: typecheck with `./node_modules/.bin/tsc --noEmit`; build with `./node_modules/.bin/next build`.

**Branching:** This phase depends on the Phase-1 UberEats code in `feat/ubereats-deals` (PR #1, unmerged). Branch this work off `feat/ubereats-deals` (stacked), not `main`.

---

## File Structure

- **Modify `lib/deals.ts`** — extend `Deal` (`discount` kind + `platform`); `extractDeals` stamps `platform: "ubereats"`.
- **Modify `lib/deals.test.ts`** — assert the `platform` stamp.
- **Create `lib/proxy.ts`** — shared `getProxyAgent()` reading `PROXY_URL ?? UBEREATS_PROXY_URL`.
- **Modify `lib/ubereats.ts`** — drop inline proxy code, import shared `getProxyAgent`.
- **Create `lib/doordash.ts`** — pure `parseDoorDashStores` + `getDoorDashDeals`.
- **Create `lib/doordash.test.ts`** — unit-test `parseDoorDashStores`.
- **Modify `app/api/deals/route.ts`** — fan out both platforms per restaurant, merge.
- **Modify `components/DealsPanel.tsx`** — `discount` label + per-platform order buttons.

---

## Task 1: Extend the Deal model

**Files:**
- Modify: `lib/deals.ts`
- Test: `lib/deals.test.ts`

- [ ] **Step 1: Update the existing extractDeals test to expect `platform`**

In `lib/deals.test.ts`, replace the assertion in the `extractDeals` test:

```ts
  assert.deepEqual(extractDeals(storeJson), [
    { kind: "bogo", text: "Bunch of Tulips (10 Stems)" },
    { kind: "free_item", text: "Chocolate Chip Cookie" },
  ]);
```

with:

```ts
  assert.deepEqual(extractDeals(storeJson), [
    { kind: "bogo", text: "Bunch of Tulips (10 Stems)", platform: "ubereats" },
    { kind: "free_item", text: "Chocolate Chip Cookie", platform: "ubereats" },
  ]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/deals.test.ts`
Expected: FAIL — `extractDeals` results lack the `platform` property.

- [ ] **Step 3: Extend the type and stamp the platform**

In `lib/deals.ts`, replace the `Deal` type:

```ts
export type Deal = { kind: "bogo" | "free_item"; text: string };
```

with:

```ts
export type Deal = {
  kind: "bogo" | "free_item" | "discount";
  text: string;
  platform: "ubereats" | "doordash";
};
```

Then in `extractDeals`, replace:

```ts
    deals.push({ kind, text });
```

with:

```ts
    deals.push({ kind, text, platform: "ubereats" });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/deals.test.ts`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 5: Typecheck (catches any Deal consumers needing the new field)**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: errors in `lib/ubereats.ts`/`DealsPanel.tsx`? No — `getUberEatsDeals` returns whatever `extractDeals` produces, and `DealsPanel` only reads `kind`/`text`. Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/deals.ts lib/deals.test.ts
git commit -m "feat(deals): add discount kind and platform field to Deal"
```

---

## Task 2: Shared proxy agent

**Files:**
- Create: `lib/proxy.ts`
- Modify: `lib/ubereats.ts`

No unit test — environment-dependent IO. Verified by typecheck + build.

- [ ] **Step 1: Create the shared proxy module**

Create `lib/proxy.ts`:

```ts
import { ProxyAgent } from "undici";

// Shared residential-proxy agent for scrapers that need a non-datacenter egress
// IP: UberEats geolocates by requesting IP, DoorDash gates on IP reputation.
// PROXY_URL is the canonical var; UBEREATS_PROXY_URL is kept for back-compat.
// Format: http://user:pass@gate.example.com:port
let proxyAgent: ProxyAgent | null | undefined;

export function getProxyAgent(): ProxyAgent | null {
  if (proxyAgent !== undefined) return proxyAgent;
  const url = process.env.PROXY_URL ?? process.env.UBEREATS_PROXY_URL;
  proxyAgent = url ? new ProxyAgent(url) : null;
  return proxyAgent;
}
```

- [ ] **Step 2: Point UberEats at the shared module**

In `lib/ubereats.ts`, remove the `undici` import line:

```ts
import { ProxyAgent } from "undici";
```

and remove the inline proxy block:

```ts
let proxyAgent: ProxyAgent | null | undefined;
function getProxyAgent(): ProxyAgent | null {
  if (proxyAgent !== undefined) return proxyAgent;
  const url = process.env.UBEREATS_PROXY_URL;
  proxyAgent = url ? new ProxyAgent(url) : null;
  return proxyAgent;
}
```

Then add this import next to the other `@/lib` imports in `lib/ubereats.ts`:

```ts
import { getProxyAgent } from "@/lib/proxy";
```

(The two existing `getProxyAgent()` call sites in `searchUberEats`/`fetchStorefront` are unchanged.)

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add lib/proxy.ts lib/ubereats.ts
git commit -m "refactor(deals): shared getProxyAgent (PROXY_URL) for both scrapers"
```

---

## Task 3: DoorDash deals scraper

**Files:**
- Create: `lib/doordash.ts`
- Test: `lib/doordash.test.ts`

- [ ] **Step 1: Write the failing test for the pure parser**

Create `lib/doordash.test.ts`. The fixture mirrors the verified real layout: per store, `promotion_title` precedes `store_latitude`/`store_longitude`/`store_name` (which sit together). The RSC escapes quotes as `\"`, so the fixture uses `\\"` in a normal string.

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoorDashStores } from "./doordash";

test("parseDoorDashStores: extracts name/coords and co-located promotion_title", () => {
  const html =
    'x\\"promotion_title\\":\\"$5 off on $35+\\",y' +
    '\\"store_latitude\\":40.732246,\\"store_longitude\\":-74.003377,\\"store_name\\":\\"Bleecker Street Pizza\\",z' +
    'x\\"promotion_title\\":\\"\\",y' +
    '\\"store_latitude\\":40.7461,\\"store_longitude\\":-73.9921,\\"store_name\\":\\"Plain Slice\\",z';
  assert.deepEqual(parseDoorDashStores(html), [
    { name: "Bleecker Street Pizza", lat: 40.732246, lng: -74.003377, promotionTitle: "$5 off on $35+" },
    { name: "Plain Slice", lat: 40.7461, lng: -73.9921, promotionTitle: "" },
  ]);
});

test("parseDoorDashStores: a store's promo does not leak to the next store", () => {
  // Only the first store has a promo; the second must come back with "".
  const html =
    'a\\"promotion_title\\":\\"20% off on $20+\\",b' +
    '\\"store_latitude\\":1.0,\\"store_longitude\\":2.0,\\"store_name\\":\\"Has Promo\\",c' +
    '\\"store_latitude\\":3.0,\\"store_longitude\\":4.0,\\"store_name\\":\\"No Promo\\",d';
  assert.deepEqual(parseDoorDashStores(html), [
    { name: "Has Promo", lat: 1.0, lng: 2.0, promotionTitle: "20% off on $20+" },
    { name: "No Promo", lat: 3.0, lng: 4.0, promotionTitle: "" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test lib/doordash.test.ts`
Expected: FAIL — cannot find module `./doordash`.

- [ ] **Step 3: Implement the parser + fetcher**

Create `lib/doordash.ts`:

```ts
// DoorDash discount deals by parsing the SSR'd /search/store/ HTML. Each store's
// analytics object co-locates store_name/store_latitude/store_longitude, with the
// store's promotion_title ~500-600 chars earlier in the same per-store segment
// (verified 2026-06-05). No formal contract — the page structure can change.
//
// DoorDash gates on IP reputation AND TLS/JA3 fingerprint. From a residential
// origin a plain fetch works; from a datacenter (Vercel) it 403s. The shared
// residential proxy fixes the IP but not the fingerprint — see SCRAPER_NOTES.md.
// Failures return [] so the restaurant simply has no DoorDash deal.

import { readCache, writeCache } from "@/lib/cache";
import { getProxyAgent } from "@/lib/proxy";
import type { Deal } from "@/lib/deals";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MATCH_RADIUS_M = 150;
const TTL_SECONDS = 60 * 60 * 12; // 12h — promos rotate

export type DoorDashStore = { name: string; lat: number; lng: number; promotionTitle: string };

function lastCapture(s: string, re: RegExp): string | null {
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(s)) !== null) last = m[1];
  return last;
}

export function parseDoorDashStores(html: string): DoorDashStore[] {
  const plain = html.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const anchors: { name: string; idx: number }[] = [];
  const nameRe = /"store_name":"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(plain)) !== null) anchors.push({ name: m[1], idx: m.index });

  const out: DoorDashStore[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < anchors.length; i++) {
    const { name, idx } = anchors[i];
    const prev = i > 0 ? anchors[i - 1].idx : 0;
    // Fields for this store live in [prev, idx]; take the match closest to the
    // name (lastCapture) so a previous store's values can't leak forward.
    const win = plain.slice(prev, idx);
    const lat = lastCapture(win, /"store_latitude":(-?[0-9.]+)/g);
    const lng = lastCapture(win, /"store_longitude":(-?[0-9.]+)/g);
    const promo = lastCapture(win, /"promotion_title":"([^"]*)"/g);
    if (lat === null || lng === null) continue;
    const key = `${name}|${lat}|${lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, lat: parseFloat(lat), lng: parseFloat(lng), promotionTitle: promo ?? "" });
  }
  return out;
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

async function fetchSearchHtml(query: string, lat: number, lng: number): Promise<string> {
  const agent = getProxyAgent();
  const url = `https://www.doordash.com/search/store/${encodeURIComponent(query)}/?lat=${lat}&lng=${lng}`;
  const init = {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
    },
    ...(agent && { dispatcher: agent }),
  } as Parameters<typeof fetch>[1];
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`doordash search ${res.status}`);
  return res.text();
}

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test lib/doordash.test.ts`
Expected: PASS — 2 tests, 0 failures.

- [ ] **Step 5: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add lib/doordash.ts lib/doordash.test.ts
git commit -m "feat(deals): DoorDash discount scraper via search RSC"
```

---

## Task 4: Merge DoorDash into the deals API

**Files:**
- Modify: `app/api/deals/route.ts`

- [ ] **Step 1: Add the DoorDash import**

In `app/api/deals/route.ts`, add next to the existing `getUberEatsDeals` import:

```ts
import { getDoorDashDeals } from "@/lib/doordash";
```

- [ ] **Step 2: Fan out both platforms per restaurant and merge**

In `app/api/deals/route.ts`, replace:

```ts
      const deals = await getUberEatsDeals(r.name, r.lat, r.lng);
      return [r.id, deals] as const;
```

with:

```ts
      const [uber, doordash] = await Promise.all([
        getUberEatsDeals(r.name, r.lat, r.lng),
        getDoorDashDeals(r.name, r.lat, r.lng),
      ]);
      return [r.id, [...uber, ...doordash]] as const;
```

- [ ] **Step 3: Typecheck**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/deals/route.ts
git commit -m "feat(deals): merge DoorDash deals into /api/deals"
```

---

## Task 5: Per-platform deal rendering in DealsPanel

**Files:**
- Modify: `components/DealsPanel.tsx`

- [ ] **Step 1: Add the discount label**

In `components/DealsPanel.tsx`, replace:

```tsx
const KIND_LABEL: Record<Deal["kind"], string> = {
  bogo: "BOGO",
  free_item: "Free item",
};
```

with:

```tsx
const KIND_LABEL: Record<Deal["kind"], string> = {
  bogo: "BOGO",
  free_item: "Free item",
  discount: "Discount",
};

const PLATFORM_LABEL: Record<Deal["platform"], string> = {
  ubereats: "Order on UberEats",
  doordash: "Order on DoorDash",
};

const PLATFORM_BG: Record<Deal["platform"], string> = {
  ubereats: "bg-green-600 hover:bg-green-700",
  doordash: "bg-red-500 hover:bg-red-600",
};
```

- [ ] **Step 2: Render a button per platform that has a deal**

In `components/DealsPanel.tsx`, replace the single hardcoded order link:

```tsx
          <a
            href={orderUrl("ubereats", r.name)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 w-full rounded-full bg-green-600 px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition hover:bg-green-700"
          >
            Order on UberEats
          </a>
```

with:

```tsx
          <div className="mt-1 flex gap-1.5">
            {[...new Set(deals[r.id].map((d) => d.platform))].map((p) => (
              <a
                key={p}
                href={orderUrl(p, r.name)}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex-1 rounded-full px-2 py-1 text-center text-xs font-semibold text-white shadow-sm transition ${PLATFORM_BG[p]}`}
              >
                {PLATFORM_LABEL[p]}
              </a>
            ))}
          </div>
```

- [ ] **Step 3: Typecheck + lint**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: exit 0. (`orderUrl` already accepts a `Platform` which is the same `"ubereats" | "doordash" | "grubhub"` union, so `Deal["platform"]` is assignable.)

- [ ] **Step 4: Commit**

```bash
git add components/DealsPanel.tsx
git commit -m "feat(deals): per-platform deal badges and order buttons"
```

---

## Task 6: Live verification

**Files:** none (manual verification)

- [ ] **Step 1: Run all unit tests**

Run: `npx tsx --test lib/deals.test.ts lib/doordash.test.ts`
Expected: PASS — 7 tests total, 0 failures.

- [ ] **Step 2: Typecheck + production build**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/next build`
Expected: both succeed; `/api/deals` listed as a route.

- [ ] **Step 3: Smoke-test DoorDash discounts from this residential machine**

Start `npm run dev`, then hit `/api/deals` with a store known to carry a DoorDash discount in this area. Run from the residential machine (no proxy needed locally):

```bash
curl -s -X POST http://localhost:3000/api/deals \
  -H 'Content-Type: application/json' \
  -d '{"restaurants":[{"id":"bleecker","name":"Bleecker Street Pizza","lat":40.732246,"lng":-74.003377}]}' | python3 -m json.tool
```

Expected: `bleecker` has a `{ "kind": "discount", "text": "<$ or % off>", "platform": "doordash" }` entry (UberEats entries may also appear). An empty array is possible if that store's promo rotated off or DoorDash challenged the request — retry once or try another nearby pizzeria from a fresh `doordash.com/search/store/pizza/` page. Confirm the discount `text` matches what DoorDash shows for that store (attribution correctness).

- [ ] **Step 4: Smoke-test the UI**

Open `http://localhost:3000`, load restaurants, open the **Deals** tab. Expected: restaurants with DoorDash discounts show a "Discount: …" badge and an "Order on DoorDash" button; UberEats BOGO/free-item still render with their button. (Requires `GOOGLE_API_KEY` to populate restaurants.)

- [ ] **Step 5: Final commit (if verification required fixes)**

```bash
git add -A
git commit -m "test(deals): DoorDash discount live verification"
```

---

## Self-Review

**Spec coverage:**
- `discount` kind + `platform` field → Task 1. ✓
- Shared `lib/proxy.ts` (`PROXY_URL ?? UBEREATS_PROXY_URL`), UberEats refactor → Task 2. ✓
- Pure `parseDoorDashStores` + `getDoorDashDeals` (search RSC, name+coord match, 12h cache, silent-degrade) → Task 3. ✓
- `/api/deals` parallel fan-out + merge → Task 4. ✓
- `DealsPanel` discount label + per-platform buttons → Task 5. ✓
- Pure parser unit-tested, live smoke incl. attribution check, no new framework → Tasks 3, 6. ✓
- UberEats stays BOGO/free-item; cycletls not built (fallback-only) → not in any task (correct). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `Deal` = `{ kind: "bogo"|"free_item"|"discount"; text; platform: "ubereats"|"doordash" }` used identically across `lib/deals.ts`, `lib/doordash.ts`, `app/api/deals/route.ts`, `components/DealsPanel.tsx`. `getDoorDashDeals(name,lat,lng): Promise<Deal[]>` matches the `getUberEatsDeals` signature used in Task 4. `parseDoorDashStores`/`DoorDashStore` consistent between Task 3 impl and test. `orderUrl(p, name)` accepts `Deal["platform"]` (subset of `Platform`). ✓
