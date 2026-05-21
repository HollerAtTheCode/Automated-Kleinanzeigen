import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { ListingDraft, PublishAssistState } from "../shared/types.js";
import { config } from "./config.js";

const POST_FORM_SELECTORS = ["input[name='title']", "input#postad-title", "input[placeholder*='Titel']"];
const START_URL = "https://www.kleinanzeigen.de/";

export async function startPublishAssist(draft: ListingDraft): Promise<PublishAssistState> {
  await fs.mkdir(config.playwrightProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(config.playwrightProfileDir, {
    headless: false,
    viewport: { width: 1280, height: 900 }
  });
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    const formReady = await openPostForm(page);
    if (!formReady) {
      return {
        status: "ready_for_user",
        message:
          "Der Kleinanzeigen-Browser ist geöffnet. Bitte logge dich ein und klicke dort auf „Inserieren“; danach kannst du die Anzeige mit den Daten aus der App prüfen.",
        url: page.url()
      };
    }

    await fillFirstAvailable(page, POST_FORM_SELECTORS, draft.title);
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

async function openPostForm(page: Page) {
  await page.goto(START_URL, {
    waitUntil: "domcontentloaded",
    timeout: 45_000
  });

  const deadline = Date.now() + 5 * 60_000;
  let loginClicked = false;

  while (Date.now() < deadline) {
    if (await hasVisible(page, POST_FORM_SELECTORS)) return true;

    if (await page.getByText("Fehler [500]", { exact: false }).isVisible().catch(() => false)) {
      await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 45_000 });
    }

    if (await clickFirstAvailable(page, ["a:has-text('Inserieren')", "button:has-text('Inserieren')", "a[href*='anzeige-aufgeben']"])) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(1000);
      continue;
    }

    const loginFormVisible = await page.locator("input[type='password']").first().isVisible().catch(() => false);
    if (!loginClicked && !loginFormVisible) {
      loginClicked = await clickFirstAvailable(page, ["button:has-text('Einloggen')", "a:has-text('Einloggen')"]);
    }

    await page.waitForTimeout(2000);
  }

  return false;
}

async function hasVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    if (await locator.isVisible().catch(() => false)) return true;
  }
  return false;
}

async function clickFirstAvailable(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) continue;
    if (!(await locator.isVisible().catch(() => false))) continue;
    await locator.click();
    return true;
  }
  return false;
}

async function fillFirstAvailable(page: Page, selectors: string[], value: string) {
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
