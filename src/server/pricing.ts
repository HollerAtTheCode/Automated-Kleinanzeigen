import type { ComparableListing, PriceRecommendation } from "../shared/types.js";

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

function roundCommercial(price: number) {
  if (price < 20) return Math.max(1, Math.round(price));
  if (price < 100) return Math.max(5, Math.round(price / 5) * 5);
  return Math.max(10, Math.round(price / 10) * 10);
}

export function recommendPrice(listings: ComparableListing[]): PriceRecommendation {
  const explicitExcluded = new Set(listings.filter((listing) => listing.excluded).map((listing) => listing.id));
  const priced = listings
    .filter((listing) => !listing.excluded && typeof listing.price === "number" && listing.price > 0)
    .map((listing) => ({ ...listing, price: listing.price as number }));

  if (priced.length === 0) {
    return {
      suggestedPrice: null,
      medianPrice: null,
      weightedMidPrice: null,
      sampleSize: 0,
      usedListingIds: [],
      excludedListingIds: [...explicitExcluded],
      rationale: "Keine belastbaren Vergleichspreise gefunden."
    };
  }

  const sortedPrices = priced.map((listing) => listing.price).sort((a, b) => a - b);
  const q1 = quantile(sortedPrices, 0.25) ?? sortedPrices[0];
  const q3 = quantile(sortedPrices, 0.75) ?? sortedPrices[sortedPrices.length - 1];
  const iqr = q3 - q1;
  const lowerFence = Math.max(1, q1 - iqr * 1.5);
  const upperFence = q3 + iqr * 1.5;
  const filtered = priced.filter((listing) => listing.price >= lowerFence && listing.price <= upperFence);
  const usable = filtered.length >= Math.min(3, priced.length) ? filtered : priced;
  const usedPrices = usable.map((listing) => listing.price).sort((a, b) => a - b);
  const median = quantile(usedPrices, 0.5);
  const scoreTotal = usable.reduce((sum, listing) => sum + Math.max(0.1, listing.score), 0);
  const weighted = usable.reduce((sum, listing) => sum + listing.price * Math.max(0.1, listing.score), 0) / scoreTotal;
  const targetBase = ((median ?? weighted) + weighted) / 2;
  const suggestedPrice = roundCommercial(targetBase);
  const usedListingIds = usable.map((listing) => listing.id);
  const outlierIds = priced.filter((listing) => !usedListingIds.includes(listing.id)).map((listing) => listing.id);

  return {
    suggestedPrice,
    medianPrice: median === null ? null : Math.round(median),
    weightedMidPrice: Math.round(weighted),
    sampleSize: usable.length,
    usedListingIds,
    excludedListingIds: [...explicitExcluded, ...outlierIds],
    rationale:
      usable.length < 3
        ? "Wenige Vergleichspreise: Median und gewichtete Mitte kombiniert, kaufmännisch gerundet."
        : "Ausreißer entfernt, Median und gewichtete Mitte kombiniert, kaufmännisch gerundet."
  };
}
