import { z } from "zod";

export const ProductAnalysisSchema = z.object({
  productType: z.string().min(1).catch("Unbekannter Artikel"),
  brand: z.string().optional(),
  model: z.string().optional(),
  condition: z.enum(["new", "like_new", "good", "fair", "defective", "unknown"]).catch("unknown"),
  confidence: z.number().min(0).max(1).catch(0.35),
  detectedAttributes: z.record(z.string(), z.string()).catch({}),
  openQuestions: z.array(z.string()).catch([]),
  searchQueries: z.array(z.string()).min(1).catch(["gebrauchter Artikel"]),
  suggestedCategory: z.string().optional()
});

export function parseJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  return JSON.parse(raw.trim());
}
