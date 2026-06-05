import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDoorDashStores, matchStore } from "./doordash";

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
