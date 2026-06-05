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
