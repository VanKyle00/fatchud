import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOffer, extractDeals, collectStrings } from "./deals";

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
