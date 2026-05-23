import { describe, expect, it } from "vitest";
import {
  CONSERVATIVE_CONDITION_INSTRUCTIONS,
  PRODUCT_ANALYSIS_TEXT_FORMAT,
  ProductAnalysisSchema,
  applyConservativeConditionPolicy,
  parseExcludedListingIds,
  parseJsonObject,
  parseSearchQueries,
  parseSessionId
} from "../src/server/validators.js";
import { isLoopbackHost } from "../src/server/config.js";

describe("ProductAnalysisSchema", () => {
  it("keeps required fields and defaults uncertain recognition", () => {
    const result = ProductAnalysisSchema.parse({
      productType: "",
      condition: "mystery",
      confidence: 4,
      detectedAttributes: null,
      searchQueries: []
    });

    expect(result.productType).toBe("Unbekannter Artikel");
    expect(result.condition).toBe("unknown");
    expect(result.confidence).toBe(0.35);
    expect(result.searchQueries).toEqual(["gebrauchter Artikel"]);
  });

  it("parses fenced JSON responses", () => {
    expect(parseJsonObject("```json\n{\"productType\":\"Kamera\"}\n```")).toEqual({ productType: "Kamera" });
  });

  it("uses an OpenAI structured-output compatible schema", () => {
    expect(JSON.stringify(PRODUCT_ANALYSIS_TEXT_FORMAT.schema)).not.toContain("propertyNames");
  });

  it("documents conservative condition rules for image analysis", () => {
    expect(CONSERVATIVE_CONDITION_INSTRUCTIONS).toContain("Kratzer");
    expect(CONSERVATIVE_CONDITION_INSTRUCTIONS).toContain("nicht 'new' oder 'like_new'");
    expect(CONSERVATIVE_CONDITION_INSTRUCTIONS).toContain("unsicher");
  });

  it("downgrades optimistic AI conditions when damage evidence is present", () => {
    const result = applyConservativeConditionPolicy({
      productType: "Kamera",
      brand: "Sony",
      model: "RX100",
      condition: "like_new",
      confidence: 0.8,
      detectedAttributes: { zustand: "leichte Kratzer am Gehaeuse, kleine Delle an der Ecke" },
      searchQueries: ["Sony RX100"],
      suggestedCategory: "Foto"
    });

    expect(result.condition).toBe("good");
    expect(result.saleNotes).toContain("Kratzer");
  });

  it("uses fair instead of like_new for strong damage evidence", () => {
    const result = applyConservativeConditionPolicy({
      productType: "Kamera",
      condition: "new",
      confidence: 0.8,
      detectedAttributes: { display: "Displayriss und Gehaeuseschaden sichtbar" },
      searchQueries: ["Kamera"],
      suggestedCategory: "Foto"
    });

    expect(result.condition).toBe("fair");
  });

  it("replaces damage-negating sale notes when damage evidence exists", () => {
    const result = applyConservativeConditionPolicy({
      productType: "Kamera",
      condition: "like_new",
      confidence: 0.8,
      detectedAttributes: { zustand: "Kratzer am Objektivring" },
      searchQueries: ["Kamera"],
      suggestedCategory: "Foto",
      saleNotes: "Kratzer oder Beschädigungen gibt es keine."
    });

    expect(result.condition).toBe("good");
    expect(result.saleNotes).toContain("Kratzer am Objektivring");
    expect(result.saleNotes).not.toContain("gibt es keine");
  });

  it("does not downgrade when notes explicitly deny damage", () => {
    const result = applyConservativeConditionPolicy({
      productType: "Kamera",
      condition: "like_new",
      confidence: 0.8,
      detectedAttributes: { zustand: "sehr gepflegt" },
      searchQueries: ["Kamera"],
      suggestedCategory: "Foto",
      saleNotes: "Kratzer oder Beschädigungen gibt es keine."
    });

    expect(result.condition).toBe("like_new");
  });

  it("rejects non-UUID session ids before filesystem use", () => {
    expect(() => parseSessionId("../outside")).toThrow(/Invalid session id/);
    expect(parseSessionId("00000000-0000-4000-8000-000000000000")).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("bounds and deduplicates price-search queries", () => {
    expect(parseSearchQueries([" Kamera ", "Kamera", "Objektiv"], ["fallback"])).toEqual(["Kamera", "Objektiv"]);
    expect(() => parseSearchQueries(["a", "b", "c", "d", "e"], [])).toThrow(/Invalid search queries/);
    expect(() => parseSearchQueries(["x".repeat(121)], [])).toThrow(/Invalid search queries/);
  });

  it("allows only compact comparable listing ids in draft exclusions", () => {
    expect([...parseExcludedListingIds(["a_1", "a_1", "b-2"])]).toEqual(["a_1", "b-2"]);
    expect(() => parseExcludedListingIds(["../../secret"])).toThrow(/Invalid excluded listing ids/);
  });

  it("distinguishes loopback hosts from exposed bind addresses", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("192.168.1.20")).toBe(false);
  });
});
