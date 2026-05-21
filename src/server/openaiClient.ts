import fs from "node:fs/promises";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ListingDraft, PriceRecommendation, ProductAnalysis } from "../shared/types.js";
import { config, getOpenaiApiKey } from "./config.js";
import type { StoredSessionState } from "./sessionStore.js";
import { AIProductAnalysisSchema, ProductAnalysisSchema, parseJsonObject } from "./validators.js";

function fallbackAnalysis(): ProductAnalysis {
  return {
    productType: "Unbekannter Artikel",
    condition: "unknown",
    confidence: 0.2,
    detectedAttributes: {},
    openQuestions: ["Was genau wird verkauft?", "Gibt es bekannte Mängel?", "Welches Zubehör ist enthalten?"],
    searchQueries: ["gebrauchter Artikel Kleinanzeigen"],
    suggestedCategory: "Sonstiges"
  };
}

function makeClient() {
  const apiKey = getOpenaiApiKey();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
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

  const response = await client.responses.create({
    model: config.openaiModel,
    text: {
      format: zodTextFormat(AIProductAnalysisSchema, "product_analysis")
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              "Analysiere diese Produktbilder für einen privaten Kleinanzeigen-Verkauf. Antworte ausschließlich als JSON mit productType, brand, model, condition, confidence, detectedAttributes, openQuestions, searchQueries, suggestedCategory."
          },
          ...imageInputs
        ]
      }
    ]
  });

  try {
    const parsedJson = JSON.parse(response.output_text);
    const parsed = ProductAnalysisSchema.safeParse(parsedJson);
    if (parsed.success) return parsed.data;
  } catch {
    // The request uses Structured Outputs, so this should only happen on provider/API failures.
  }

  throw Object.assign(new Error("Die Bildanalyse konnte nicht ausgewertet werden. Bitte versuche es erneut."), { statusCode: 502 });
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
