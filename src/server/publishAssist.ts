import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { ListingDraft, PublishAssistState } from "../shared/types.js";
import { config } from "./config.js";

export async function startPublishAssist(draft: ListingDraft): Promise<PublishAssistState> {
  await fs.mkdir(config.playwrightProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(config.playwrightProfileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 }
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await page.goto("https://www.kleinanzeigen.de/p-anzeige-aufgeben.html", {
      waitUntil: "domcontentloaded",
      timeout: 45_000
    });

    await fillFirstAvailable(page, ["input[name='title']", "input#postad-title", "input[placeholder*='Titel']"], draft.title);
    if (draft.price.suggestedPrice) {
      await fillFirstAvailable(
        page,
        ["input[name='priceAmount']", "input#pstad-price", "input[placeholder*='Preis']"],
        String(draft.price.suggestedPrice)
      );
    }
    await fillFirstAvailable(
      page,
      ["textarea[name='description']", "textarea#pstad-descrptn", "textarea[placeholder*='Beschreibung']"],
      draft.description
    );

    return {
      status: "ready_for_user",
      message: "Der Kleinanzeigen-Browser ist geöffnet. Bitte Login, Kategorie, Bilder, Details und Veröffentlichung manuell prüfen.",
      url: page.url()
    };
  } catch (error) {
    return {
      status: "failed",
      message: error instanceof Error ? error.message : "Publish-Assist konnte nicht gestartet werden.",
      url: page.url()
    };
  }
}

async function fillFirstAvailable(page: import("playwright").Page, selectors: string[], value: string) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.fill(value);
    return true;
  }
  return false;
}

export function browserProfileRelativePath() {
  return path.relative(config.rootDir, config.playwrightProfileDir);
}
