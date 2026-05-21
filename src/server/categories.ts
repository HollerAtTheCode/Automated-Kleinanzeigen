import type { ProductAnalysis } from "../shared/types.js";

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[ä]/g, "a")
    .replace(/[ö]/g, "o")
    .replace(/[ü]/g, "u")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKleinanzeigenCategory(analysis: Pick<ProductAnalysis, "productType" | "brand" | "model" | "suggestedCategory">) {
  const current = analysis.suggestedCategory?.trim() ?? "";
  const haystack = normalizeText([analysis.productType, analysis.brand, analysis.model, current].filter(Boolean).join(" "));

  if (/\b(iphone|smartphone|handy|telefon)\b/.test(haystack)) {
    return "Elektronik → Handy & Telefon → Handys";
  }

  if (/\b(osmo|pocket|kamera|camera|camcorder|actioncam|gimbal|objektiv|foto|video)\b/.test(haystack)) {
    return "Elektronik → Foto → Kamera";
  }

  if (/\b(kaffeemuehle|kaffeemuhle|muehle|muhle|comandante)\b/.test(haystack)) {
    return "Haus & Garten → Küche & Esszimmer";
  }

  return current;
}
