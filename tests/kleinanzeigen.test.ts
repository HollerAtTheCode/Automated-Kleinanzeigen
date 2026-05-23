import { describe, expect, it } from "vitest";
import type { ProductAnalysis } from "../src/shared/types.js";
import { isWantedListing, normalizeQueries, scoreListing, searchUrl } from "../src/server/kleinanzeigen.js";

const damagedCamera: ProductAnalysis = {
  productType: "Gimbal Kamera",
  brand: "DJI",
  model: "Osmo Pocket 3 Creator Combo",
  condition: "fair",
  confidence: 0.8,
  detectedAttributes: { zustand: "Kratzer am Gehaeuse und sichtbare Gebrauchsspuren" },
  searchQueries: ["DJI Osmo Pocket 3 Creator Combo"],
  suggestedCategory: "Elektronik"
};

const goodCamera: ProductAnalysis = {
  ...damagedCamera,
  condition: "good",
  detectedAttributes: { zustand: "gepflegt" }
};

describe("Kleinanzeigen listing matching", () => {
  it("uses brand and model as the preferred market-search query", () => {
    expect(normalizeQueries(["DJI Osmo Pocket 3 Creator Combo", "Gimbal Kamera"], damagedCamera)).toEqual([
      "DJI Osmo Pocket 3 Creator Combo"
    ]);
  });

  it("does not duplicate the brand when the model already contains it", () => {
    expect(
      normalizeQueries([], {
        ...damagedCamera,
        model: "DJI Osmo Pocket 3 Creator Combo"
      })
    ).toEqual(["DJI Osmo Pocket 3 Creator Combo"]);
  });

  it("builds offer-only search URLs with the matching condition filter", () => {
    expect(searchUrl("DJI Osmo Pocket 3 Creator Combo", damagedCamera)).toBe(
      "https://www.kleinanzeigen.de/s-anzeige:angebote/DJI-Osmo-Pocket-3-Creator-Combo/k0+global.zustand:ok"
    );
  });

  it("excludes search ads even when the title does not start with suche", () => {
    expect(isWantedListing("Ich suche eine DJI Osmo Pocket 3 in der Creator Combo", damagedCamera)).toBe(false);
    expect(isWantedListing("DJI Osmo Pocket 3 gesucht, gerne Creator Combo", damagedCamera)).toBe(false);
  });

  it("excludes premium-condition listings for a damaged own product", () => {
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo / wie neu", damagedCamera)).toBe(false);
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo NEU OVP", damagedCamera)).toBe(false);
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo kaum benutzt + Zubehör", damagedCamera)).toBe(false);
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo TOP Zustand", damagedCamera)).toBe(false);
  });

  it("keeps damaged listings for damaged own products when the model matches", () => {
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo mit Kratzer am Gehaeuse", damagedCamera)).toBe(true);
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo defekt als Ersatzteil", damagedCamera)).toBe(true);
  });

  it("still filters damaged listings for non-damaged own products", () => {
    expect(isWantedListing("DJI Osmo Pocket 3 Creator Combo defekt als Ersatzteil", goodCamera)).toBe(false);
  });

  it("downscores premium-condition titles for damaged own products", () => {
    const matchedUsedScore = scoreListing("DJI Osmo Pocket 3 Creator Combo mit Kratzern", "DJI Osmo Pocket 3 Creator Combo", damagedCamera);
    const premiumScore = scoreListing("DJI Osmo Pocket 3 Creator Combo wie neu OVP", "DJI Osmo Pocket 3 Creator Combo", damagedCamera);

    expect(premiumScore).toBeLessThan(matchedUsedScore);
    expect(premiumScore).toBeLessThanOrEqual(0.25);
  });
});
