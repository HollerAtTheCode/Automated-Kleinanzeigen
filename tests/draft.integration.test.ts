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

  it("polishes vague image-analysis wording into direct seller language", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kamera",
        brand: "DJI",
        model: "Osmo Pocket 3",
        condition: "good",
        confidence: 0.9,
        detectedAttributes: { zubehoer: "Kamera, Tasche, USB-C Kabel" },
        searchQueries: ["Osmo Pocket 3"],
        suggestedCategory: "Foto",
        saleNotes:
          "Das Display wirkt sauber ohne tiefe Kratzer. Den vollständigen Lieferumfang kann ich nicht garantieren. Anhand der Bilder scheint das Objektivglas sauber. Ob alle Kleinteile komplett sind, kann ich nicht sagen."
      },
      comparables: [{ id: "a", source: "kleinanzeigen", title: "DJI Osmo Pocket 3", price: 300, url: "https://example.test/a", score: 1 }]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.description).toContain("Das Display ist sauber und ohne tiefe Kratzer.");
    expect(draft.description).toContain("Das Objektivglas ist sauber.");
    expect(draft.description).not.toMatch(/wirkt|scheint|anhand der Bilder|kann ich nicht garantieren|kann ich nicht sagen/i);
  });

  it("formats known accessory sets as a bullet list", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kamera",
        brand: "DJI",
        model: "Osmo Pocket 3",
        condition: "good",
        confidence: 0.9,
        detectedAttributes: { lieferumfang: "Kamera, Tasche, USB-C Kabel" },
        searchQueries: ["Osmo Pocket 3"],
        suggestedCategory: "Foto",
        saleNotes: "Ich verkaufe meine DJI Osmo Pocket 3."
      },
      comparables: [{ id: "a", source: "kleinanzeigen", title: "DJI Osmo Pocket 3", price: 300, url: "https://example.test/a", score: 1 }]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.description).toContain("Lieferumfang:\n- DJI Osmo Pocket 3\n- Kamera\n- Tasche\n- USB-C Kabel");
  });

  it("does not turn neutral no-damage condition notes into usage marks", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kamera",
        brand: "DJI",
        model: "Osmo Pocket 3",
        condition: "like_new",
        confidence: 0.9,
        detectedAttributes: {
          zustand: "Display ohne klar erkennbare Kratzer, Objektivglas sauber und ohne erkennbare Kratzer, Gimbal und Kamerakopf ohne sichtbare Beschädigungen oder Dellen",
          lieferumfang: "Transporttasche, Griff/Ministativ, Funkmikro mit Fell-Windschutz, USB-C Kabel, Handschlaufe, Putztuch"
        },
        searchQueries: ["DJI Osmo Pocket 3"],
        suggestedCategory: "Foto",
        saleNotes: "Ich verkaufe hier meine DJI Osmo Pocket 3. Das Display ist sauber und ohne erkennbare Kratzer oder Risse."
      },
      comparables: [{ id: "a", source: "kleinanzeigen", title: "DJI Osmo Pocket 3", price: 400, url: "https://example.test/a", score: 1 }]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.description).toMatch(/^Ich verkaufe hier meine DJI Osmo Pocket 3\./);
    expect(draft.condition).toBe("like_new");
    expect(draft.description).not.toContain("Der Zustand ist gebraucht mit folgenden Gebrauchsspuren:");
    expect(draft.description).not.toMatch(/Bitte prüfe|vor dem Einstellen|kann ich nicht/i);
    expect(draft.description).toContain("Lieferumfang:\n- DJI Osmo Pocket 3\n- Transporttasche\n- Griff/Ministativ\n- Funkmikro mit Fell-Windschutz");
  });

  it("turns actual damage evidence into seller-ready condition wording", async () => {
    const session: StoredSessionState = {
      id: "test",
      createdAt: new Date(0).toISOString(),
      images: [{ id: "img1", filename: "front.jpg", mimeType: "image/jpeg", size: 100, path: "/tmp/front.jpg" }],
      analysis: {
        productType: "Kamera",
        brand: "DJI",
        model: "Osmo Pocket 3",
        condition: "like_new",
        confidence: 0.9,
        detectedAttributes: {
          zustand: "leichte Kratzer am Gehäuse neben dem Objektiv, Display ohne erkennbare Kratzer oder Risse",
          lieferumfang: "Kamera, Weitwinkellinse, Tragetasche, Funkmikro, USB-C Kabel"
        },
        searchQueries: ["DJI Osmo Pocket 3"],
        suggestedCategory: "Foto",
        saleNotes: "Kratzer oder Beschädigungen gibt es keine."
      },
      comparables: [{ id: "a", source: "kleinanzeigen", title: "DJI Osmo Pocket 3", price: 400, url: "https://example.test/a", score: 1 }]
    };

    const draft = await generateDraft(session, recommendPrice(session.comparables));

    expect(draft.condition).toBe("good");
    expect(draft.description).toContain("leichte Kratzer am Gehäuse neben dem Objektiv");
    expect(draft.description).not.toContain("Display ohne erkennbare Kratzer oder Risse.");
    expect(draft.description).toContain("Lieferumfang:\n- DJI Osmo Pocket 3\n- Kamera\n- Weitwinkellinse\n- Tragetasche\n- Funkmikro\n- USB-C Kabel");
  });
});
