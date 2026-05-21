import fs from "node:fs/promises";
import OpenAI, { APIError } from "openai";
import type { ListingDraft, PriceRecommendation, ProductAnalysis } from "../shared/types.js";
import { config, getOpenaiApiKey } from "./config.js";
import type { StoredSessionState } from "./sessionStore.js";
import { PRODUCT_ANALYSIS_TEXT_FORMAT, ProductAnalysisSchema, parseJsonObject } from "./validators.js";

function fallbackAnalysis(): ProductAnalysis {
  return {
    productType: "Unbekannter Artikel",
    condition: "unknown",
    confidence: 0.2,
    detectedAttributes: {},
    openQuestions: ["Was genau wird verkauft?", "Gibt es bekannte Mängel?", "Welches Zubehör ist enthalten?"],
    searchQueries: ["gebrauchter Artikel Kleinanzeigen"],
    suggestedCategory: "Sonstiges",
    saleNotes: ""
  };
}

function makeClient() {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function normalizeOpenAIError(error: unknown): Error {
  if (error instanceof APIError) {
    if (error.status === 401) {
      return Object.assign(new Error("Der OpenAI API-Key wurde abgelehnt. Bitte prüfe den Key."), { statusCode: 401 });
    }
    if (error.status === 429) {
      return Object.assign(new Error("OpenAI hat das aktuelle Limit erreicht. Bitte später erneut versuchen."), { statusCode: 429 });
    }
    return Object.assign(new Error("Die OpenAI-Anfrage ist fehlgeschlagen. Bitte erneut versuchen."), { statusCode: 502 });
  }
  return error instanceof Error ? error : new Error("Die OpenAI-Anfrage ist fehlgeschlagen. Bitte erneut versuchen.");
}

function normalizeAnalysisPayload(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const payload = value as { detectedAttributes?: unknown };
  if (Array.isArray(payload.detectedAttributes)) {
    return {
      ...payload,
      detectedAttributes: Object.fromEntries(
        payload.detectedAttributes
          .filter(
            (entry): entry is { name: string; value: string } =>
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as { name?: unknown }).name === "string" &&
              typeof (entry as { value?: unknown }).value === "string"
          )
          .map((entry) => [entry.name, entry.value])
      )
    };
  }
  return value;
}

export async function analyzeProduct(session: StoredSessionState): Promise<ProductAnalysis> {
  const client = makeClient();
  if (!client) {
    throw Object.assign(new Error("Für die automatische Bildanalyse fehlt ein OpenAI API-Key."), { statusCode: 428 });
  }

  const imageInputs = await Promise.all(
    session.images.slice(0, 8).map(async (image) => ({
      type: "input_image" as const,
      image_url: `data:${image.mimeType};base64,${await fs.readFile(image.path, "base64")}`,
      detail: "auto" as const
    }))
  );

  const response = await client.responses
    .create({
      model: config.openaiModel,
      text: {
        format: PRODUCT_ANALYSIS_TEXT_FORMAT
      },
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Analysiere diese Produktbilder für einen privaten Kleinanzeigen-Verkauf. Fülle alle Felder im vorgegebenen Schema. saleNotes soll bereits wie ein natürlicher Text aus Sicht des Verkäufers klingen, nicht wie eine externe Bildbeobachtung. Schreibe in der Ich-Form, mit 2 bis 4 kurzen Absätzen, verkaufsnah und sachlich. Beschreibe Zustand, Zubehör und Gebrauchsspuren so, als würde ich meinen eigenen Artikel anbieten. Verwende keine Semikolons. Verwende keine Formulierungen wie 'auf den Fotos sichtbar', 'sichtbarer Zustand', 'wirkt', 'erkennbar', 'aufgefallen', 'ich kann erkennen', 'anhand der Bilder' oder 'technische Mängel'. Erfinde keine Mängel. Wenn keine Mängel erkennbar sind und der Zustand gut ist, schreibe klar aus Verkäufersicht: 'Kratzer oder Beschädigungen gibt es keine.' Wenn Marke, Modell, Kategorie oder Zustand nicht sicher erkennbar sind, nutze leere Strings beziehungsweise unknown und stelle konkrete Rückfragen in openQuestions."
            },
            ...imageInputs
          ]
        }
      ]
    })
    .catch((error: unknown) => {
      throw normalizeOpenAIError(error);
    });

  try {
    const parsedJson = normalizeAnalysisPayload(JSON.parse(response.output_text));
    const parsed = ProductAnalysisSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data;
  } catch {
    // The request uses Structured Outputs, so this should only happen on provider/API failures.
  }

  throw Object.assign(new Error("Die Bildanalyse konnte nicht ausgewertet werden. Bitte versuche es erneut."), { statusCode: 502 });
}

export async function generateSaleNotes(session: StoredSessionState): Promise<string> {
  const analysis = session.analysis ?? fallbackAnalysis();
  const client = makeClient();
  const existingNotes = analysis.saleNotes?.trim() ?? "";
  if (!client) return existingNotes;

  const response = await client.responses
    .create({
      model: config.openaiModel,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                instruction:
                  "Schreibe den Text für das Feld 'Hinweise oder Mängel' einer privaten Kleinanzeigen-Anzeige komplett neu. Perspektive: Ich verkaufe meinen eigenen Artikel. Stil: natürlich, verkaufsnah, freundlich, aber sachlich. Struktur: 2 bis 4 kurze Absätze mit Leerzeilen. Schreibe wie ein normaler Mensch in einer Kleinanzeige, nicht wie ein Gutachten. Verwende keine Semikolons. Nutze Zustand, Zubehör und typische Informationen aus ähnlichen Anzeigen als Kontext, aber kopiere keine fremden Anzeigen wörtlich. Keine distanzierten Bildanalyse-Formulierungen wie 'auf den Fotos sichtbar', 'sichtbarer Zustand', 'wirkt', 'erkennbar', 'aufgefallen', 'ich kann erkennen', 'anhand der Bilder' oder 'technische Mängel'. Erwähne Mängel nur, wenn sie vom Nutzer angegeben wurden oder aus der Analyse klar hervorgehen. Wenn keine Mängel bekannt sind, schreibe klar aus Verkäufersicht, z. B. 'Kratzer oder Beschädigungen gibt es keine.' Keine Garantien und keine übertriebene Werbesprache.",
                product: analysis,
                comparableListings: session.comparables.slice(0, 8).map((listing) => ({
                  title: listing.title,
                  price: listing.price,
                  description: listing.description
                }))
              })
            }
          ]
        }
      ]
    })
    .catch((error: unknown) => {
      throw normalizeOpenAIError(error);
    });

  return response.output_text.trim().slice(0, 1200) || existingNotes;
}

export async function generateDraft(session: StoredSessionState, price: PriceRecommendation): Promise<ListingDraft> {
  const analysis = session.analysis ?? fallbackAnalysis();
  const client = makeClient();
  const imageOrder = session.images.map((image) => image.id);

  if (!client) {
    const parts = [analysis.brand, analysis.model, analysis.productType].filter(Boolean);
    return {
      title: parts.join(" ").slice(0, 80) || "Artikel zu verkaufen",
      description: [
        `Ich verkaufe ${parts.join(" ") || "diesen Artikel"}.`,
        `Zustand: ${analysis.condition === "unknown" ? "siehe Fotos" : analysis.condition}.`,
        "Privatverkauf, keine Garantie oder Rücknahme."
      ].join("\n\n"),
      categoryHint: analysis.suggestedCategory,
      price,
      imageOrder,
      missingFacts: analysis.openQuestions
    };
  }

  const response = await client.responses.create({
    model: config.openaiModel,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              instruction:
                "Erstelle eine Kleinanzeigen-Anzeige für Privatverkauf als JSON mit title, description, categoryHint, missingFacts. Maximal sachlich, keine nicht belegten Behauptungen, keine rechtlich heiklen Superlative.",
              analysis,
              saleNotes: analysis.saleNotes,
              price,
              comparables: session.comparables.slice(0, 12)
            })
          }
        ]
      }
    ]
  });

  try {
    const parsed = parseJsonObject(response.output_text) as Partial<ListingDraft>;
    return {
      title: String(parsed.title ?? `${analysis.brand ?? ""} ${analysis.model ?? ""} ${analysis.productType}`.trim()).slice(0, 80),
      description: String(parsed.description ?? ""),
      categoryHint: typeof parsed.categoryHint === "string" ? parsed.categoryHint : analysis.suggestedCategory,
      price,
      imageOrder,
      missingFacts: Array.isArray(parsed.missingFacts) ? parsed.missingFacts.map(String) : analysis.openQuestions
    };
  } catch {
    return {
      title: `${analysis.brand ?? ""} ${analysis.model ?? ""} ${analysis.productType}`.trim().slice(0, 80),
      description: "Beschreibung konnte nicht automatisch erstellt werden. Bitte prüfen und ergänzen.",
      categoryHint: analysis.suggestedCategory,
      price,
      imageOrder,
      missingFacts: analysis.openQuestions
    };
  }
}
