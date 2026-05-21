import { z } from "zod";

const MAX_SEARCH_QUERIES = 4;
const MAX_SEARCH_QUERY_LENGTH = 120;
const MAX_EXCLUDED_LISTING_IDS = 100;

export const ProductAnalysisSchema = z.object({
  productType: z.string().min(1).catch("Unbekannter Artikel"),
  brand: z.string().optional(),
  model: z.string().optional(),
  condition: z.enum(["new", "like_new", "good", "fair", "defective", "unknown"]).catch("unknown"),
  confidence: z.number().min(0).max(1).catch(0.35),
  detectedAttributes: z.record(z.string(), z.string()).catch({}),
  openQuestions: z.array(z.string()).catch([]),
  searchQueries: z.array(z.string()).min(1).catch(["gebrauchter Artikel"]),
  suggestedCategory: z.string().optional(),
  saleNotes: z.string().optional()
});

export const AIProductAnalysisSchema = z.object({
  productType: z.string().min(1),
  brand: z.string(),
  model: z.string(),
  condition: z.enum(["new", "like_new", "good", "fair", "defective", "unknown"]),
  confidence: z.number().min(0).max(1),
  detectedAttributes: z.record(z.string(), z.string()),
  openQuestions: z.array(z.string()),
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
      "openQuestions",
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
      openQuestions: { type: "array", items: { type: "string" } },
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
