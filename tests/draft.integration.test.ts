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
        suggestedCategory: "Haushalt",
        saleNotes: "Ich verkaufe meine Comandante C40. Sie ist gepflegt und funktioniert einwandfrei."
      },
      comparables: [
        { id: "a", source: "kleinanzeigen", title: "Comandante C40", price: 180, url: "https://example.test/a", score: 1 },
        { id: "b", source: "kleinanzeigen", title: "C40 Kaffeemuehle", price: 200, url: "https://example.test/b", score: 0.8 }
      ]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.title).toContain("Comandante");
    expect(draft.description).toContain("Ich verkaufe meine Comandante C40. Sie ist gepflegt und funktioniert einwandfrei.");
    expect(draft.description).toMatch(/Privatverkauf/);
    expect(draft.description).toMatch(/Preisvorstellung: 180 € VB/);
    expect(draft.condition).toBe("good");
    expect(draft.price.suggestedPrice).toBe(180);
    expect(draft.imageOrder).toEqual(["img1"]);
  });

  it("does not carry damage-negating notes into the draft when analysis has damage evidence", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kamera",
        brand: "Sony",
        model: "RX100",
        condition: "like_new",
        confidence: 0.9,
        detectedAttributes: { zustand: "Kratzer am Gehaeuse und kleine Delle an der Ecke" },
        openQuestions: [],
        searchQueries: ["Sony RX100"],
        suggestedCategory: "Foto",
        saleNotes: "Kratzer oder Beschädigungen gibt es keine."
      },
      comparables: [{ id: "a", source: "kleinanzeigen", title: "Sony RX100", price: 220, url: "https://example.test/a", score: 1 }]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.condition).toBe("good");
    expect(draft.description).toContain("Kratzer am Gehaeuse");
    expect(draft.description).not.toContain("Kratzer oder Beschädigungen gibt es keine");
  });
});
