import { describe, expect, it } from "vitest";
import { generateDraft } from "../src/server/openaiClient.js";
import { recommendPrice } from "../src/server/pricing.js";
import type { StoredSessionState } from "../src/server/sessionStore.js";

describe("draft integration without external services", () => {
  it("creates an editable fallback draft from mocked analysis and comparables", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kaffeemuehle",
        brand: "Comandante",
        model: "C40",
        condition: "good",
        confidence: 0.9,
        detectedAttributes: { farbe: "schwarz" },
        openQuestions: ["Ist die Originalverpackung vorhanden?"],
        searchQueries: ["Comandante C40 schwarz"],
        suggestedCategory: "Haushalt"
      },
      comparables: [
        { id: "a", source: "kleinanzeigen", title: "Comandante C40", price: 180, url: "https://example.test/a", score: 1 },
        { id: "b", source: "kleinanzeigen", title: "C40 Kaffeemuehle", price: 200, url: "https://example.test/b", score: 0.8 }
      ]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.title).toContain("Comandante");
    expect(draft.description).toMatch(/Privatverkauf/);
    expect(draft.condition).toBe("good");
    expect(draft.price.suggestedPrice).toBe(180);
    expect(draft.imageOrder).toEqual(["img1"]);
  });
});
