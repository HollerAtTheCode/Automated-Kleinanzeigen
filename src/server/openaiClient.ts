import fs from "node:fs/promises";
import OpenAI, { APIError } from "openai";
import type { ListingDraft, PriceRecommendation, ProductAnalysis } from "../shared/types.js";
import { config, getOpenaiApiKey } from "./config.js";
import type { StoredSessionState } from "./sessionStore.js";
import {
  CONSERVATIVE_CONDITION_INSTRUCTIONS,
  PRODUCT_ANALYSIS_TEXT_FORMAT,
  ProductAnalysisSchema,
  applyConservativeConditionPolicy
} from "./validators.js";
import { normalizeKleinanzeigenCategory } from "./categories.js";

function fallbackAnalysis(): ProductAnalysis {
  const analysis: ProductAnalysis = {
    productType: "Unbekannter Artikel",
    condition: "unknown",
    confidence: 0.2,
    detectedAttributes: {},
    openQuestions: ["Was genau wird verkauft?", "Gibt es bekannte Mängel?", "Welches Zubehör ist enthalten?"],
    searchQueries: ["gebrauchter Artikel Kleinanzeigen"],
    suggestedCategory: "Sonstiges",
    saleNotes: "",
    fulfillmentMethod: "shipping",
    priceType: "negotiable"
  };
  return { ...analysis, suggestedCategory: normalizeKleinanzeigenCategory(analysis) };
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

const vagueSentencePatterns = [
  /\bkann ich nicht garantieren\b/i,
  /\bnicht zu 100\s*%\s*garantieren\b/i,
  /\bkann ich nicht feststellen\b/i,
  /\bkann ich nicht sagen\b/i,
  /\bl(?:ä|ae)sst sich nicht feststellen\b/i,
  /\bnicht sicher (?:sagen|beurteilen|einsch(?:ä|ae)tzen)\b/i,
  /\bkeine sichere aussage\b/i,
  /\bnicht ausschlie(?:ß|ss)en\b/i,
  /\bbitte pr(?:ü|ue)fe\b/i,
  /\bvor dem einstellen\b/i
];

const vaguePhraseReplacements: Array<[RegExp, string]> = [
  [/\bsoweit ich erkennen kann\b/gi, ""],
  [/\banhand der Bilder\b/gi, ""],
  [/\bwirkt\b/gi, "ist"],
  [/\bscheint\b/gi, "ist"],
  [/\bvermutlich\b/gi, ""],
  [/\bmöglicherweise\b/gi, ""]
];

function polishListingText(text: string) {
  const withoutDisclaimerSentences = text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !vagueSentencePatterns.some((pattern) => pattern.test(sentence)))
    .join(" ");

  const polished = vaguePhraseReplacements
    .reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), withoutDisclaimerSentences)
    .replace(/\bist\s+(das|der|die)\s+([^.?!]+?)\s+(sauber|gepflegt|in ordnung)\b/gi, (_match: string, article: string, subject: string, adjective: string) => {
      const capitalizedArticle = `${article.charAt(0).toUpperCase()}${article.slice(1).toLowerCase()}`;
      return `${capitalizedArticle} ${subject.trim()} ist ${adjective}`;
    })
    .replace(/^Der Artikel ist gebraucht und hat Gebrauchsspuren:/i, "Der Zustand ist gebraucht mit folgenden Gebrauchsspuren:")
    .replace(/\b(ist\s+(?:sauber|gepflegt|in ordnung))\s+ohne\b/gi, "$1 und ohne")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return polished;
}

function splitAccessoryItems(value: string) {
  return value
    .split(/[,;]|\s+\+\s+|\s+und\s+/i)
    .map((item) => item.replace(/^(?:und|mit|inkl\.?|inklusive)\s+/i, "").trim())
    .filter((item) => item.length > 1);
}

function normalizeAccessoryLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, " ").trim();
}

function accessoryItems(analysis: ProductAnalysis) {
  const detectedItems = Object.entries(analysis.detectedAttributes ?? {})
    .filter(([name]) => /zubehör|zubehoer|lieferumfang|enthalten|included/i.test(name))
    .flatMap(([, value]) => splitAccessoryItems(value));
  if (detectedItems.length === 0) return [];

  const itemName = listingItemName(analysis);
  const items = [itemName, ...detectedItems].filter(Boolean);
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const label = normalizeAccessoryLabel(item);
      if (!label || seen.has(label)) return false;
      seen.add(label);
      return true;
    })
    .slice(0, 10);
}

function existingAccessoryItems(text: string) {
  const match = text.match(/(?:^|\n)(?:Lieferumfang|Zubehör|Zubehoer):\s*\n((?:\s*-\s+.+(?:\n|$))+)/i);
  if (!match) return [];
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^\s*-\s+/, "").trim())
    .filter(Boolean);
}

function removeAccessoryList(text: string) {
  return text.replace(/(?:^|\n)(?:Lieferumfang|Zubehör|Zubehoer):\s*\n(?:\s*-\s+.+(?:\n|$))+/i, "\n").trim();
}

function appendAccessoryList(text: string, analysis: ProductAnalysis) {
  const items = accessoryItems(analysis);
  const existingItems = existingAccessoryItems(text);
  if (items.length < 2 && existingItems.length === 0) return text;
  if (existingItems.length >= items.length) return text;
  const body = existingItems.length > items.length ? text : removeAccessoryList(text);
  return [body, `Lieferumfang:\n${items.map((item) => `- ${item}`).join("\n")}`].filter(Boolean).join("\n\n");
}

function listingItemName(analysis: ProductAnalysis) {
  return [analysis.brand, analysis.model].filter(Boolean).join(" ").trim() || analysis.productType || "Artikel";
}

function hasSellerIntro(text: string) {
  return /^(ich\s+verkaufe|zum\s+verkauf|verkaufe\s+hier)\b/i.test(text.trim());
}

function ensureSellerIntro(text: string, analysis: ProductAnalysis) {
  const trimmed = text.trim();
  if (!trimmed || hasSellerIntro(trimmed)) return trimmed;
  return [`Ich verkaufe hier meine ${listingItemName(analysis)}.`, trimmed].join("\n\n");
}

function prepareListingDescription(baseText: string, analysis: ProductAnalysis) {
  return appendAccessoryList(ensureSellerIntro(polishListingText(baseText), analysis), analysis);
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
              text: [
                "Analysiere diese Produktbilder für einen privaten Kleinanzeigen-Verkauf. Fülle alle Felder im vorgegebenen Schema.",
                CONSERVATIVE_CONDITION_INSTRUCTIONS,
                "Erfasse den angebotenen Artikel und den kompletten sichtbar mitverkauften Lieferumfang besonders sorgfältig. Schreibe in detectedAttributes ein Feld 'lieferumfang' mit dem Hauptartikel plus allen klar sichtbaren Zubehörteilen, z. B. Kamera, Weitwinkellinse, Tragetasche, Mikrofon, Kabel, Griff, Ministativ, Originalverpackung. Nenne nur Teile, die auf den Bildern klar erkennbar sind. Erfasse echte Mängel wie Kratzer, Dellen, Display- oder Gehäuseschäden, fehlende Teile und deutliche Gebrauchsspuren separat und konkret in detectedAttributes. Wichtig: Aussagen wie 'Display ohne erkennbare Kratzer oder Risse' sind neutrale Zustandsbeschreibung, kein Mangel und keine Gebrauchsspur. Wenn Kratzer klar sichtbar sind, benenne sie direkt mit Ort, z. B. Kratzer am Gehäuse um die Linse. saleNotes soll wie eine vollständige private Kleinanzeigen-Beschreibung klingen, nicht wie eine externe Bildbeobachtung. Beginne wie eine echte Anzeige, z. B. 'Ich verkaufe hier meine ...'. Schreibe in der Ich-Form, mit 3 bis 5 kurzen Absätzen, verkaufsnah und sachlich. Beschreibe Artikel, Nutzung, Zustand und Lieferumfang so, als würde ich meinen eigenen Artikel anbieten. Verwende keine Semikolons. Verwende aktive, direkte Verkäufersprache wie 'Das Display ist sauber und ohne Kratzer' statt 'wirkt sauber'. Verwende keine Formulierungen wie 'auf den Fotos sichtbar', 'sichtbarer Zustand', 'wirkt', 'scheint', 'vermutlich', 'möglich', 'soweit ich erkennen kann', 'aufgefallen', 'ich kann erkennen', 'anhand der Bilder', 'möchte ich nicht ausschließen', 'kann ich nicht garantieren', 'kann ich nicht feststellen', 'kann ich nicht sagen', 'lässt sich nicht feststellen', 'nicht sicher beurteilen', 'bitte prüfe' oder 'technische Mängel'. Schreibe keine Anweisungen an mich in saleNotes. Erfinde keine Mängel. Behaupte nur dann, dass es keine Kratzer oder Beschädigungen gibt, wenn alle relevanten sichtbaren Flächen klar unbeschädigt sind. Unklare Details gehören in openQuestions, nicht als Disclaimer in saleNotes. Wenn mehrere Zubehörteile sicher erkennbar sind, formatiere sie in saleNotes als Bullet List unter 'Lieferumfang:'. Wenn Marke, Modell, Kategorie oder Zustand nicht sicher erkennbar sind, nutze leere Strings beziehungsweise unknown und stelle konkrete Rückfragen in openQuestions."
              ].join(" ")
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
    if (parsed.success) {
      const conservativeAnalysis = applyConservativeConditionPolicy(parsed.data);
      return { ...conservativeAnalysis, suggestedCategory: normalizeKleinanzeigenCategory(conservativeAnalysis) };
    }
  } catch {
    // The request uses Structured Outputs, so this should only happen on provider/API failures.
  }

  throw Object.assign(new Error("Die Bildanalyse konnte nicht ausgewertet werden. Bitte versuche es erneut."), { statusCode: 502 });
}

export async function generateSaleNotes(session: StoredSessionState): Promise<string> {
  const analysis = applyConservativeConditionPolicy(session.analysis ?? fallbackAnalysis());
  const client = makeClient();
  const existingNotes = analysis.saleNotes?.trim() ?? "";
  if (!client) return prepareListingDescription(existingNotes, analysis);

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
                  "Schreibe die Artikelbeschreibung für eine private Kleinanzeigen-Anzeige komplett neu. Perspektive: Ich verkaufe meinen eigenen Artikel und habe ihn vor mir. Der Text muss direkt veröffentlichbar sein, nicht wie eine Prüfanweisung oder ein Analyseprotokoll. Stil: natürlich, verkaufsnah, freundlich, aber sachlich. Beginne wie eine echte Anzeige, z. B. 'Ich verkaufe hier meine ...'. Struktur: 3 bis 5 kurze Absätze mit Leerzeilen. Schreibe wie ein normaler Mensch in einer Kleinanzeige, nicht wie ein Gutachten. Nenne zuerst klar den Artikel, danach kurz Zustand/Nutzung und danach den Lieferumfang. Verwende aktive, direkte Verkäufersprache wie 'Das Display ist sauber und ohne Kratzer' statt 'wirkt sauber'. Verwende keine Semikolons. Nutze Zustand, Zubehör und typische Informationen aus ähnlichen Anzeigen als Kontext, aber kopiere keine fremden Anzeigen wörtlich. Keine distanzierten Bildanalyse-Formulierungen wie 'auf den Fotos sichtbar', 'sichtbarer Zustand', 'wirkt', 'scheint', 'vermutlich', 'möglich', 'soweit ich erkennen kann', 'aufgefallen', 'ich kann erkennen', 'anhand der Bilder', 'möchte ich nicht ausschließen', 'kann ich nicht garantieren', 'kann ich nicht feststellen', 'kann ich nicht sagen', 'lässt sich nicht feststellen', 'nicht sicher beurteilen', 'bitte prüfe' oder 'technische Mängel'. Schreibe keine Anweisungen an mich. Wichtig: Positive oder neutrale Aussagen wie 'Display ohne erkennbare Kratzer oder Risse' sind kein Mangel und dürfen nicht unter 'Gebrauchsspuren' zusammengefasst werden. Sichtbare oder aus der Analyse hervorgehende echte Kratzer, Beschädigungen, starke Gebrauchsspuren, fehlende Teile und Funktionszweifel müssen ehrlich und konkret erwähnt werden. Wenn die Analyse z. B. Kratzer am Gehäuse, am Objektivring oder um die Linse nennt, schreibe genau das in den Text. Beschönige klare Schäden nicht als nur mögliche feine Spuren. Unbekannten Lieferumfang nicht als Disclaimer formulieren. Liste den bekannten Lieferumfang konkret auf. Wenn mehrere Zubehörteile enthalten sind, formatiere sie als Bullet List unter 'Lieferumfang:'. Keine Garantien und keine übertriebene Werbesprache.",
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

  return prepareListingDescription(response.output_text.trim().slice(0, 1200) || existingNotes, analysis);
}

export async function generateDraft(session: StoredSessionState, price: PriceRecommendation): Promise<ListingDraft> {
  const analysis = applyConservativeConditionPolicy(session.analysis ?? fallbackAnalysis());
  const imageOrder = session.images.map((image) => image.id);
  const fulfillmentMethod = analysis.fulfillmentMethod ?? "shipping";
  const priceType = analysis.priceType ?? "negotiable";
  const titleParts = [analysis.brand, analysis.model, analysis.productType].filter(Boolean);
  const itemName = [analysis.brand, analysis.model].filter(Boolean).join(" ").trim() || analysis.productType || "Artikel";
  const title = titleParts.join(" ").replace(/\s+/g, " ").trim().slice(0, 80) || "Artikel zu verkaufen";
  const baseDescription = prepareListingDescription(
    analysis.saleNotes?.trim() || `Ich verkaufe ${itemName}. Der Artikel ist gebraucht und befindet sich in dem angegebenen Zustand.`,
    analysis
  );
  const priceLine = price.suggestedPrice ? `Preisvorstellung: ${price.suggestedPrice} €${priceType === "negotiable" ? " VB" : ""}` : "";
  const fulfillmentLine = fulfillmentMethod === "pickup" ? "Nur Abholung." : "Versand oder Abholung nach Absprache möglich.";
  const description = [
    baseDescription,
    "Der Artikel wurde privat genutzt und wird wegen Nichtgebrauch abgegeben.",
    `Privatverkauf, keine Garantie oder Rücknahme durch mich. ${fulfillmentLine}`,
    priceLine
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    title,
    description,
    categoryHint: normalizeKleinanzeigenCategory(analysis),
    condition: analysis.condition,
    price,
    priceType,
    fulfillmentMethod,
    imageOrder,
    missingFacts: analysis.openQuestions
  };
}
