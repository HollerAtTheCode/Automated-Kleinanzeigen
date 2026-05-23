import { z } from "zod";
import type { ProductAnalysis } from "../shared/types.js";

const MAX_SEARCH_QUERIES = 4;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_EXCLUDED_LISTING_IDS = 100;

export const CONSERVATIVE_CONDITION_INSTRUCTIONS =
  "Bewerte den Zustand konservativ. 'new' nur bei unbenutzter Neuware mit klarer Verpackungs-/Neuwaren-Evidenz. 'like_new' nur, wenn keine sichtbaren Gebrauchsspuren, Kratzer, Dellen, Display-/Gehäuseschäden, fehlende Teile oder sonstige Mängel vorhanden sind. Sobald solche Spuren sichtbar oder plausibel unklar sind, wähle nicht 'new' oder 'like_new', sondern mindestens 'good'. Bei deutlichen Schäden, starken Gebrauchsspuren, Rissen, Display-/Gehäuseschäden, fehlenden Teilen oder Funktionszweifeln wähle 'fair' oder 'defective'. Wenn du unsicher bist, bleibe in saleNotes sachlich und wähle lieber 'good' oder 'fair' statt zu optimistisch.";

const moderateDamagePatterns = [
  /\bkratzer\w*\b/i,
  /\bkratzspur\w*\b/i,
  /\bdelle\w*\b/i,
  /\bbeule\w*\b/i,
  /\bbestoßen\w*\b/i,
  /\babplatzer\w*\b/i,
  /\bbeschädig\w*\b/i,
  /\bgebrauchsspur\w*\b/i,
  /\babgenutzt\w*\b/i,
  /\bfehl(?:t|en|end)\w*\b/i,
  /\bscratch(?:es|ed)?\b/i,
  /\bdent(?:s|ed)?\b/i,
  /\bdamag(?:e|ed|es)\b/i,
  /\bmissing\b/i,
  /\bwear\b/i
];

const strongDamagePatterns = [
  /\bstarke?\s+gebrauchsspur\w*\b/i,
  /\bdeutliche?\s+gebrauchsspur\w*\b/i,
  /\bdisplay(?:bruch|schaden|riss)\w*\b/i,
  /\bgeh(?:ä|ae)use(?:bruch|schaden|riss)\w*\b/i,
  /\briss(?:e|ig|en)?\b/i,
  /\bsprung\w*\b/i,
  /\bgebrochen\w*\b/i,
  /\bdefekt\w*\b/i,
  /\bkaputt\w*\b/i,
  /\bnicht\s+funktions\w*\b/i,
  /\bcrack(?:s|ed)?\b/i,
  /\bbroken\b/i,
  /\bdefective\b/i
];

const negatedDamagePhrases = [
  /\bkratzer\s+oder\s+beschädigungen\s+gibt\s+es\s+keine\b/gi,
  /\b(?:es\s+gibt\s+)?kein(?:e|en|er|es)?\s+(?:(?:sichtbare|erkennbare|klar\s+erkennbare)\s+)?(?:kratzer|risse|beschädigungen?|mängel|gebrauchsspuren?|schäden|damage|scratches|wear)\b/gi,
  /\bohne\s+(?:(?:sichtbare|erkennbare|klar\s+erkennbare)\s+)?(?:kratzer|risse|dellen|beschädigungen?|mängel|gebrauchsspuren?|schäden|damage|scratches|wear)(?:\s+oder\s+(?:kratzer|risse|dellen|beschädigungen?|mängel|schäden))?\b/gi
];

function normalizeEvidenceText(text: string) {
  return negatedDamagePhrases.reduce((current, pattern) => current.replace(pattern, " "), text);
}

function hasEvidence(text: string, patterns: RegExp[]) {
  const normalized = normalizeEvidenceText(text);
  if (!normalized.trim()) return false;
  return patterns.some((pattern) => pattern.test(normalized));
}

function hasDamageNegation(text: string) {
  return negatedDamagePhrases.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function hasProductDamageEvidence(analysis?: ProductAnalysis) {
  if (!analysis) return false;
  const evidenceTexts = [
    ...Object.entries(analysis.detectedAttributes ?? {}).map(([name, value]) => `${name}: ${value}`),
    analysis.saleNotes ?? ""
  ];
  return evidenceTexts.some((text) => hasEvidence(text, [...moderateDamagePatterns, ...strongDamagePatterns]));
}

function damageEvidenceSnippets(analysis: ProductAnalysis) {
  return Object.entries(analysis.detectedAttributes ?? {})
    .filter(([name, value]) => hasEvidence(`${name}: ${value}`, [...moderateDamagePatterns, ...strongDamagePatterns]))
    .flatMap(([, value]) =>
      value
        .split(/[,;\n]+/)
        .map((snippet) => snippet.trim())
        .filter((snippet) => hasEvidence(snippet, [...moderateDamagePatterns, ...strongDamagePatterns]))
    )
    .filter(Boolean)
    .slice(0, 3);
}

function conservativeDamageNotes(analysis: ProductAnalysis) {
  const snippets = damageEvidenceSnippets(analysis);
  if (snippets.length > 0) {
    return `Der Artikel ist gebraucht und hat Gebrauchsspuren: ${snippets.join(", ")}.`;
  }
  return "Der Artikel ist gebraucht und hat erkennbare Gebrauchsspuren.";
}

export function applyConservativeConditionPolicy(analysis: ProductAnalysis): ProductAnalysis {
  const evidenceTexts = [
    ...Object.entries(analysis.detectedAttributes ?? {}).map(([name, value]) => `${name}: ${value}`),
    analysis.saleNotes ?? ""
  ];
  const hasStrongDamage = evidenceTexts.some((text) => hasEvidence(text, strongDamagePatterns));
  const hasModerateDamage = hasStrongDamage || hasProductDamageEvidence(analysis);

  if (!hasModerateDamage) return analysis;

  const saleNotes = analysis.saleNotes?.trim();
  const shouldReplaceNotes = !saleNotes || hasDamageNegation(saleNotes);

  return {
    ...analysis,
    condition:
      analysis.condition === "new" || analysis.condition === "like_new"
        ? hasStrongDamage
          ? "fair"
          : "good"
        : analysis.condition,
    saleNotes: shouldReplaceNotes ? conservativeDamageNotes(analysis) : analysis.saleNotes
  };
}

export const ProductAnalysisSchema = z.object({
  productType: z.string().min(1).catch("Unbekannter Artikel"),
  brand: z.string().optional(),
  model: z.string().optional(),
  condition: z.enum(["new", "like_new", "good", "fair", "defective", "unknown"]).catch("unknown"),
  confidence: z.number().min(0).max(1).catch(0.35),
  detectedAttributes: z.record(z.string(), z.string()).catch({}),
  searchQueries: z.array(z.string()).min(1).catch(["gebrauchter Artikel"]),
  suggestedCategory: z.string().optional(),
  saleNotes: z.string().optional(),
  fulfillmentMethod: z.enum(["pickup", "shipping"]).catch("shipping"),
  priceType: z.enum(["fixed", "negotiable"]).catch("negotiable")
});

export const AIProductAnalysisSchema = z.object({
  productType: z.string().min(1),
  brand: z.string(),
  model: z.string(),
  condition: z.enum(["new", "like_new", "good", "fair", "defective", "unknown"]),
  confidence: z.number().min(0).max(1),
  detectedAttributes: z.record(z.string(), z.string()),
  searchQueries: z.array(z.string().min(1)).min(1).max(MAX_SEARCH_QUERIES),
  suggestedCategory: z.string()
});

export const PRODUCT_ANALYSIS_TEXT_FORMAT = {
  type: "json_schema" as const,
  name: "product_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "productType",
      "brand",
      "model",
      "condition",
      "confidence",
      "detectedAttributes",
      "searchQueries",
      "suggestedCategory",
      "saleNotes"
    ],
    properties: {
      productType: { type: "string" },
      brand: { type: "string" },
      model: { type: "string" },
      condition: { type: "string", enum: ["new", "like_new", "good", "fair", "defective", "unknown"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      detectedAttributes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "value"],
          properties: {
            name: { type: "string" },
            value: { type: "string" }
          }
        }
      },
      searchQueries: { type: "array", minItems: 1, maxItems: MAX_SEARCH_QUERIES, items: { type: "string" } },
      suggestedCategory: { type: "string" },
      saleNotes: { type: "string" }
    }
  }
};

export const SessionIdSchema = z.string().uuid();

export const SearchQueriesSchema = z
  .array(z.string().trim().min(1).max(MAX_SEARCH_QUERY_LENGTH))
  .max(MAX_SEARCH_QUERIES)
  .transform((queries) => [...new Set(queries)]);

export const ExcludedListingIdsSchema = z
  .array(z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/))
  .max(MAX_EXCLUDED_LISTING_IDS)
  .transform((ids) => [...new Set(ids)]);

export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw.trim());
}

export function parseSessionId(value: string): string {
  const result = SessionIdSchema.safeParse(value);
  if (!result.success) {
    throw Object.assign(new Error("Invalid session id."), { statusCode: 400 });
  }
  return result.data;
}

export function parseSearchQueries(value: unknown, fallback: string[]): string[] {
  if (value === undefined) return fallback;
  const result = SearchQueriesSchema.safeParse(value);
  if (!result.success) {
    throw Object.assign(new Error("Invalid search queries."), { statusCode: 400 });
  }
  return result.data.length > 0 ? result.data : fallback;
}

export function parseExcludedListingIds(value: unknown): Set<string> {
  const result = ExcludedListingIdsSchema.safeParse(value ?? []);
  if (!result.success) {
    throw Object.assign(new Error("Invalid excluded listing ids."), { statusCode: 400 });
  }
  return new Set(result.data);
}
