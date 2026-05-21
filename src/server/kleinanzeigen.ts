import crypto from "node:crypto";
import { chromium } from "playwright";
import type { ComparableListing, ProductAnalysis } from "../shared/types.js";

function scoreListing(title: string, query: string, analysis?: ProductAnalysis) {
  const haystack = title.toLowerCase();
  const terms = new Set(
    [query, analysis?.brand, analysis?.model, analysis?.productType]
      .filter(Boolean)
      .flatMap((value) => String(value).toLowerCase().split(/\s+/))
      .filter((term) => term.length > 2)
  );
  if (terms.size === 0) return 0.5;
  const matches = [...terms].filter((term) => haystack.includes(term)).length;
  return Math.max(0.1, Math.min(1, matches / terms.size));
}

function parsePrice(text: string): number | null {
  if (/vb|verhandlungsbasis|zu verschenken/i.test(text) && !/\d/.test(text)) return null;
  const match = text.replace(/\./g, "").match(/(\d{1,6})(?:,\d{2})?\s*EUR|€\s*(\d{1,6})|(\d{1,6})\s*€/i);
  const value = Number(match?.[1] ?? match?.[2] ?? match?.[3]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function searchKleinanzeigen(queries: string[], analysis?: ProductAnalysis): Promise<ComparableListing[]> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: "de-DE" });
  const listings = new Map<string, ComparableListing>();

  try {
    for (const query of queries.slice(0, 4)) {
      const url = `https://www.kleinanzeigen.de/s-${encodeURIComponent(query)}/k0`;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
      await page.waitForTimeout(1200);

      const items = await page.locator("article.aditem, li.ad-listitem, [data-testid*='ad']").evaluateAll((nodes) =>
        nodes.slice(0, 12).map((node) => {
          const element = node as HTMLElement;
          const link = element.querySelector<HTMLAnchorElement>("a[href]");
          const title =
            element.querySelector<HTMLElement>(".ellipsis, .text-module-begin, h2, h3")?.innerText?.trim() ??
            link?.innerText?.trim() ??
            "";
          const price = element.querySelector<HTMLElement>(".aditem-main--middle--price-shipping--price, [class*='price']")?.innerText?.trim() ?? "";
          const location = element.querySelector<HTMLElement>(".aditem-main--top--left, [class*='location']")?.innerText?.trim() ?? "";
          return { title, price, location, href: link?.href ?? "" };
        })
      );

      for (const item of items) {
        if (!item.title || !item.href) continue;
        const id = crypto.createHash("sha1").update(item.href).digest("hex").slice(0, 12);
        listings.set(id, {
          id,
          source: "kleinanzeigen",
          title: item.title,
          price: parsePrice(item.price),
          location: item.location,
          url: item.href,
          score: scoreListing(item.title, query, analysis)
        });
      }
    }
  } finally {
    await browser.close();
  }

  return [...listings.values()].sort((a, b) => b.score - a.score).slice(0, 24);
}
