import { describe, expect, it } from "vitest";
import type { ComparableListing } from "../src/shared/types.js";
import { recommendPrice } from "../src/server/pricing.js";

function listing(id: string, price: number | null, score = 0.8, excluded = false): ComparableListing {
  return {
    id,
    source: "kleinanzeigen",
    title: `Artikel ${id}`,
    price,
    location: "Berlin",
    url: `https://example.test/${id}`,
    score,
    excluded
  };
}

describe("recommendPrice", () => {
  it("filters outliers and rounds below the market midpoint", () => {
    const result = recommendPrice([
      listing("a", 90, 0.9),
      listing("b", 100, 1),
      listing("c", 110, 0.8),
      listing("d", 120, 0.7),
      listing("outlier", 900, 0.6)
    ]);

    expect(result.sampleSize).toBe(4);
    expect(result.excludedListingIds).toContain("outlier");
    expect(result.suggestedPrice).toBe(95);
    expect(result.rationale).toMatch(/konservativen Marktwert/);
  });

  it("returns no price when no valid prices exist", () => {
    const result = recommendPrice([listing("a", null), listing("b", 0)]);

    expect(result.suggestedPrice).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.rationale).toMatch(/Keine belastbaren/);
  });

  it("handles small samples conservatively", () => {
    const result = recommendPrice([listing("a", 40, 1), listing("b", 60, 1)]);

    expect(result.sampleSize).toBe(2);
    expect(result.suggestedPrice).toBe(50);
    expect(result.rationale).toMatch(/Wenige Vergleichspreise/);
  });

  it("respects manually excluded listings", () => {
    const result = recommendPrice([listing("a", 100), listing("b", 200, 1, true), listing("c", 110)]);

    expect(result.usedListingIds).not.toContain("b");
    expect(result.excludedListingIds).toContain("b");
  });

  it("uses a stronger markdown when many comparable offers are available", () => {
    const result = recommendPrice([
      listing("a", 100),
      listing("b", 100),
      listing("c", 100),
      listing("d", 100),
      listing("e", 100),
      listing("f", 100),
      listing("g", 100),
      listing("h", 100)
    ]);

    expect(result.sampleSize).toBe(8);
    expect(result.suggestedPrice).toBe(90);
    expect(result.rationale).toMatch(/10%/);
  });

  it("does not inflate skewed inlier samples through high priced listings", () => {
    const result = recommendPrice([listing("a", 100), listing("b", 100), listing("c", 150), listing("d", 250)]);

    expect(result.sampleSize).toBe(4);
    expect(result.medianPrice).toBe(125);
    expect(result.weightedMidPrice).toBe(150);
    expect(result.suggestedPrice).toBeLessThan(140);
  });
});
