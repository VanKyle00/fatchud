import { test } from "node:test";
import assert from "node:assert/strict";
import { kindFromPromoType, extractDeals, collectStrings } from "./deals";

test("kindFromPromoType: BOGO enums map to bogo", () => {
  assert.equal(kindFromPromoType("BOGO"), "bogo");
  assert.equal(kindFromPromoType("BUY_X_GET_Y"), "bogo");
});

test("kindFromPromoType: free enums map to free_item", () => {
  assert.equal(kindFromPromoType("FREE_ITEM"), "free_item");
});

test("kindFromPromoType: discounts and empty map to null", () => {
  assert.equal(kindFromPromoType("DISCOUNTED_ITEM"), null);
  assert.equal(kindFromPromoType(""), null);
  assert.equal(kindFromPromoType(null), null);
  assert.equal(kindFromPromoType(undefined), null);
});

test("collectStrings: gathers all nested string values", () => {
  const got = collectStrings({ a: "x", b: ["y", { c: "z" }], d: 5 });
  assert.deepEqual(got.sort(), ["x", "y", "z"]);
});

test("extractDeals: keeps BOGO + free-item items, ignores discounts and plain menu items", () => {
  const storeJson = {
    catalogSectionsMap: {
      s: [
        {
          payload: {
            standardItemsPayload: {
              catalogItems: [
                { title: "Bunch of Tulips (10 Stems)", catalogItemAnalyticsData: { promoType: "BOGO" } },
                { title: "Plant Beverage (42 fl oz)", catalogItemAnalyticsData: { promoType: "DISCOUNTED_ITEM" } },
                { title: "Stella Artois Alcohol Free Beer (6 x 11.2 fl oz)" }, // no promo -> ignored
                { title: "Free Range Brown Eggs (12 ct)", catalogItemAnalyticsData: { promoType: "" } }, // not a promo -> ignored
                { title: "Chocolate Chip Cookie", catalogItemAnalyticsData: { promoType: "FREE_ITEM" } },
                { title: "Bunch of Tulips (10 Stems)", catalogItemAnalyticsData: { promoType: "BOGO" } }, // dupe -> collapsed
              ],
            },
          },
        },
      ],
    },
  };
  assert.deepEqual(extractDeals(storeJson), [
    { kind: "bogo", text: "Bunch of Tulips (10 Stems)", platform: "ubereats" },
    { kind: "free_item", text: "Chocolate Chip Cookie", platform: "ubereats" },
  ]);
});
