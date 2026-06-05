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
