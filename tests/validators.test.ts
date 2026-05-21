import { describe, expect, it } from "vitest";
import { ProductAnalysisSchema, parseJsonObject } from "../src/server/validators.js";

describe("ProductAnalysisSchema", () => {
  it("keeps required fields and defaults uncertain recognition", () => {
    const result = ProductAnalysisSchema.parse({
      productType: "",
      condition: "mystery",
      confidence: 4,
      detectedAttributes: null,
      openQuestions: null,
      searchQueries: []
    });

    expect(result.productType).toBe("Unbekannter Artikel");
    expect(result.condition).toBe("unknown");
    expect(result.confidence).toBe(0.35);
    expect(result.openQuestions).toEqual([]);
    expect(result.searchQueries).toEqual(["gebrauchter Artikel"]);
  });

  it("parses fenced JSON responses", () => {
    expect(parseJsonObject("```json\n{\"productType\":\"Kamera\"}\n```")).toEqual({ productType: "Kamera" });
  });
});
