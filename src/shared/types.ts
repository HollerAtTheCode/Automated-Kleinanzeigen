export type UploadedImage = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
};

export type ProductAnalysis = {
  productType: string;
  brand?: string;
  model?: string;
  condition: "new" | "like_new" | "good" | "fair" | "defective" | "unknown";
  confidence: number;
  detectedAttributes: Record<string, string>;
  openQuestions: string[];
  searchQueries: string[];
  suggestedCategory?: string;
};

export type ComparableListing = {
  id: string;
  source: "kleinanzeigen";
  title: string;
  price: number | null;
  location?: string;
  url: string;
  score: number;
  excluded?: boolean;
  reason?: string;
};

export type PriceRecommendation = {
  suggestedPrice: number | null;
  medianPrice: number | null;
  weightedMidPrice: number | null;
  sampleSize: number;
  usedListingIds: string[];
  excludedListingIds: string[];
  rationale: string;
};

export type ListingDraft = {
  title: string;
  description: string;
  categoryHint?: string;
  price: PriceRecommendation;
  imageOrder: string[];
  missingFacts: string[];
};

export type PublishAssistState = {
  status: "idle" | "opening" | "ready_for_user" | "failed";
  message: string;
  url?: string;
};

export type SessionState = {
  id: string;
  createdAt: string;
  images: UploadedImage[];
  analysis?: ProductAnalysis;
  comparables: ComparableListing[];
  draft?: ListingDraft;
  publishAssist?: PublishAssistState;
};
