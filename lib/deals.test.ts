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
