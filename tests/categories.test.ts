import { describe, expect, it } from "vitest";
import { normalizeKleinanzeigenCategory } from "../src/server/categories.js";

describe("normalizeKleinanzeigenCategory", () => {
  it("maps DJI Osmo Pocket camera gear to Kleinanzeigen foto camera category", () => {
    expect(
      normalizeKleinanzeigenCategory({
        productType: "Handheld Gimbal Kamera",
        brand: "DJI",
        model: "Osmo Pocket 3 Creator Combo",
        suggestedCategory: "Elektronik > Kameras & Camcorder > Actioncams & Zubehör"
      })
    ).toBe("Elektronik → Foto → Kamera");
  });

  it("maps smartphones to the phone category before generic camera words", () => {
    expect(
      normalizeKleinanzeigenCategory({
        productType: "Smartphone mit Kamera",
        brand: "Apple",
        model: "iPhone 15",
        suggestedCategory: "Elektronik"
      })
    ).toBe("Elektronik → Handy & Telefon → Handys");
  });
});
