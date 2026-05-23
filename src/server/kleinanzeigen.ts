import crypto from "node:crypto";
import { chromium } from "playwright";
import type { ComparableListing, ProductAnalysis } from "../shared/types.js";
import { hasProductDamageEvidence } from "./validators.js";

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[\u2010-\u2015]/g, "-").replace(/[^a-z0-9äöüß+]+/g, " ").replace(/\s+/g, " ").trim();
}

function hasToken(text: string, token: string) {
  return new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text);
}

function isDamagedOwnProduct(analysis?: ProductAnalysis) {
  return analysis?.condition === "fair" || analysis?.condition === "defective" || hasProductDamageEvidence(analysis);
}

function isSearchListing(normalizedTitle: string) {
  return /\b(?:ich\s+)?suche\b/.test(normalizedTitle) || /\bgesucht\b/.test(normalizedTitle) || /\bauf\s+der\s+suche\b/.test(normalizedTitle);
}

function hasDamageTerms(normalizedTitle: string) {
  return /\b(defekt|kaputt|beschädigt|beschaedigt|ersatzteil|kratzer|delle|riss|gebrauchsspuren)\b/.test(normalizedTitle);
}

function hasPremiumConditionTerms(normalizedTitle: string) {
  return /\b(neu|neue|neuer|neues|wie\s+neu|neuwertig|ovp|originalverpackt|unbenutzt|kaum\s+benutzt|top\s+zustand|topzustand|sehr\s+guter\s+zustand)\b/.test(
    normalizedTitle
  );
}

export function isWantedListing(title: string, analysis?: ProductAnalysis) {
  const normalizedTitle = normalizeText(title);
  const damagedOwnProduct = isDamagedOwnProduct(analysis);
  if (isSearchListing(normalizedTitle)) return false;
  if (!damagedOwnProduct && hasDamageTerms(normalizedTitle)) return false;
  if (damagedOwnProduct && hasPremiumConditionTerms(normalizedTitle)) return false;

  const normalizedModel = normalizeText(analysis?.model ?? "");
  const wantsPocket3 = hasToken(normalizedModel, "pocket") && hasToken(normalizedModel, "3");
  if (wantsPocket3) {
    return hasToken(normalizedTitle, "pocket") && hasToken(normalizedTitle, "3");
  }

  const modelTokens = normalizedModel.split(" ").filter((token) => token.length > 2 && !["combo", "creator", "set"].includes(token));
  if (modelTokens.length >= 2) {
    const matches = modelTokens.filter((token) => hasToken(normalizedTitle, token)).length;
    return matches >= Math.ceil(modelTokens.length * 0.66);
  }

  return true;
}

export function scoreListing(title: string, query: string, analysis?: ProductAnalysis) {
  const haystack = normalizeText(title);
  const terms = new Set(
    [query, analysis?.brand, analysis?.model, analysis?.productType]
      .filter(Boolean)
      .flatMap((value) => normalizeText(String(value)).split(/\s+/))
      .filter((term) => term.length > 2)
  );
  if (terms.size === 0) return 0.5;
  const matches = [...terms].filter((term) => hasToken(haystack, term)).length;
  const conditionMultiplier = isDamagedOwnProduct(analysis) && hasPremiumConditionTerms(haystack) ? 0.25 : 1;
  return Math.max(0.1, Math.min(1, (matches / terms.size) * conditionMultiplier));
}

function parsePrice(text: string): number | null {
  if (/vb|verhandlungsbasis|zu verschenken/i.test(text) && !/\d/.test(text)) return null;
  const match = text.replace(/\./g, "").match(/(\d{1,6})(?:,\d{2})?\s*EUR|€\s*(\d{1,6})|(\d{1,6})\s*€/i);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function searchPath(query: string) {
  return encodeURIComponent(query.trim().replace(/\s+/g, "-"));
}

function modelSearchQuery(analysis?: ProductAnalysis) {
  const model = analysis?.model?.trim();
  const brand = analysis?.brand?.trim();
  if (model && model.length > 2) {
    if (brand && !normalizeText(model).includes(normalizeText(brand))) {
      return `${brand} ${model}`;
    }
    return model;
  }
  return [analysis?.brand, analysis?.productType].filter(Boolean).join(" ").trim();
}

function fallbackQueries(analysis?: ProductAnalysis) {
  if (!analysis) return [];
  return [modelSearchQuery(analysis), analysis.productType].filter((query): query is string => Boolean(query && query.length > 2));
}

export function normalizeQueries(queries: string[], analysis?: ProductAnalysis) {
  const preferredModelQuery = modelSearchQuery(analysis);
  if (preferredModelQuery.length > 2) return [preferredModelQuery];
  return [...new Set([...queries, ...fallbackQueries(analysis)].map((query) => query.trim()).filter((query) => query.length > 2))].slice(0, 3);
}

function conditionFilterSuffix(analysis?: ProductAnalysis) {
  if (!analysis) return "";
  if (analysis.condition === "new") return "+global.zustand:new";
  if (analysis.condition === "like_new") return "+global.zustand:like_new";
  if (analysis.condition === "good" || analysis.condition === "fair" || hasProductDamageEvidence(analysis)) return "+global.zustand:ok";
  return "";
}

export function searchUrl(query: string, analysis?: ProductAnalysis) {
  return `https://www.kleinanzeigen.de/s-anzeige:angebote/${searchPath(query)}/k0${conditionFilterSuffix(analysis)}`;
}

export async function searchKleinanzeigen(queries: string[], analysis?: ProductAnalysis): Promise<ComparableListing[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "de-DE" });
  const listings = new Map<string, ComparableListing>();

  try {
    for (const query of normalizeQueries(queries, analysis)) {
      const url = searchUrl(query, analysis);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(1200);

      const items = await page.locator("article.aditem, li.ad-listitem, [data-testid*='ad'], a[href*='/s-anzeige/']").evaluateAll((nodes) =>
        nodes.slice(0, 30).map((node) => {
          const element = node as HTMLElement;
          const card = element.closest("article, li, [data-testid*='ad']") as HTMLElement | null;
          const source = card ?? element;
          const link = source.matches("a[href]") ? (source as HTMLAnchorElement) : source.querySelector<HTMLAnchorElement>("a[href]");
          const title =
            source.querySelector<HTMLElement>(".ellipsis, .text-module-begin, h2, h3, [data-testid*='title']")?.innerText?.trim() ??
            link?.getAttribute("title")?.trim() ??
            link?.innerText?.trim() ??
            "";
          const price =
            source.querySelector<HTMLElement>(".aditem-main--middle--price-shipping--price, [class*='price'], [data-testid*='price']")?.innerText?.trim() ??
            source.innerText;
          const location =
            source.querySelector<HTMLElement>(".aditem-main--top--left, [class*='location'], [data-testid*='location']")?.innerText?.trim() ?? "";
          const description = source.innerText?.replace(/\s+/g, " ").trim().slice(0, 600) ?? "";
          return { title, price, location, href: link?.href ?? "", description };
        })
      );

      for (const item of items) {
        if (!item.title || !item.href) continue;
        if (!isWantedListing(item.title, analysis)) continue;
        const id = crypto.createHash("sha1").update(item.href).digest("hex").slice(0, 12);
        listings.set(id, {
          id,
          source: "kleinanzeigen",
          title: item.title,
          price: parsePrice(item.price),
          location: item.location,
          url: item.href,
          score: scoreListing(item.title, query, analysis),
          description: item.description
        });
      }
    }

    const topListings = [...listings.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    for (const listing of topListings) {
      try {
        await page.goto(listing.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        await page.waitForTimeout(600);
        const detailText = await page
          .locator("#viewad-description-text, [data-testid*='description'], .boxedarticle--details, article")
          .first()
          .innerText({ timeout: 2500 })
          .catch(() => "");
        if (detailText.trim()) {
          listing.description = detailText.replace(/\s+/g, " ").trim().slice(0, 1200);
        }
      } catch {
        // Listing detail pages are best-effort context only.
      }
    }
  } finally {
    await browser.close();
  }

  return [...listings.values()].sort((a, b) => b.score - a.score).slice(0, 24);
}
