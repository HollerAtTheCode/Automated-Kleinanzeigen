import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import type { ListingDraft, PublishAssistState } from "../shared/types.js";
import { config } from "./config.js";
import type { StoredUploadedImage } from "./sessionStore.js";

const POST_FORM_SELECTORS = ["input[name='title']", "input#postad-title", "input[placeholder*='Titel']"];
const START_URL = "https://www.kleinanzeigen.de/";

export async function startPublishAssist(draft: ListingDraft, images: StoredUploadedImage[] = []): Promise<PublishAssistState> {
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
    await selectPriceType(page, draft.priceType);
    await selectCategory(page, draft.categoryHint);
    await uploadImages(page, orderedImagePaths(images, draft.imageOrder));

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

function orderedImagePaths(images: StoredUploadedImage[], imageOrder: string[]) {
  const byId = new Map(images.map((image) => [image.id, image]));
  const ordered = imageOrder.map((id) => byId.get(id)).filter((image): image is StoredUploadedImage => Boolean(image));
  const remaining = images.filter((image) => !imageOrder.includes(image.id));
  return [...ordered, ...remaining].map((image) => image.path);
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

async function selectPriceType(page: Page, priceType: ListingDraft["priceType"]) {
  const targetLabel = priceType === "negotiable" ? "Verhandlungsbasis" : "Festpreis";
  const targetValue = priceType === "negotiable" ? "NEGOTIABLE" : "FIXED";
  const wanted = priceType === "negotiable" ? [/verhandlungsbasis/i, /^vb$/i, /negotiable/i] : [/festpreis/i, /fixed/i];

  const customCombobox = page.locator("#ad-price-type").first();
  if ((await customCombobox.count()) > 0 && (await customCombobox.isVisible().catch(() => false))) {
    await customCombobox.click();
    await page.waitForTimeout(250);
    if (
      await clickFirstAvailable(page, [
        `[role='option']:has-text('${targetLabel}')`,
        `[role='menuitem']:has-text('${targetLabel}')`,
        `button:has-text('${targetLabel}')`,
        `li:has-text('${targetLabel}')`,
        `div:has-text('${targetLabel}')`
      ])
    ) {
      return true;
    }
  }

  const selects = await page.locator("select").all();
  for (const select of selects) {
    if (!(await select.isVisible().catch(() => false))) continue;
    const options = await select.locator("option").evaluateAll((nodes) =>
      nodes.map((node) => ({ value: (node as HTMLOptionElement).value, text: (node.textContent ?? "").trim() }))
    );
    const match = options.find((option) => wanted.some((pattern) => pattern.test(option.text) || pattern.test(option.value)));
    if (!match) continue;
    await select.selectOption(match.value);
    return true;
  }

  for (const text of [targetLabel, priceType === "negotiable" ? "VB" : "Festpreis"]) {
    if (await clickFirstAvailable(page, [`button:has-text('${text}')`, `[role='option']:has-text('${text}')`, `text=${text}`])) return true;
  }

  return page.evaluate(
    ({ value, label }) => {
      const input = document.querySelector<HTMLInputElement>("input[name='priceType']");
      if (!input) return false;
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      const selected = document.querySelector<HTMLElement>("#ad-price-type-selected-option");
      if (selected) selected.textContent = label;
      return true;
    },
    { value: targetValue, label: targetLabel }
  );
}

async function selectCategory(page: Page, categoryHint?: string) {
  const categoryOptions = await page.locator("input[type='radio']").evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const input = node as HTMLInputElement;
      const label = input.closest("label");
      const row = input.parentElement;
      return {
        index,
        checked: input.checked,
        text: (label?.textContent ?? row?.textContent ?? "").replace(/\s+/g, " ").trim()
      };
    })
  );
  const candidates = categoryOptions.filter((option) => option.text.includes("→"));
  if (candidates.some((option) => option.checked)) return true;
  const wantedTokens = normalizeCategoryText(categoryHint ?? "")
    .split(" ")
    .filter((token) => token.length > 3 && !["elektronik", "zubehor", "weitere"].includes(token));
  const ranked = candidates
    .map((option) => ({
      ...option,
      score: wantedTokens.filter((token) => normalizeCategoryText(option.text).includes(token)).length
    }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  if (!selected) return false;
  const radio = page.locator("input[type='radio']").nth(selected.index);
  await radio.check();
  return true;
}

function normalizeCategoryText(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[ä]/g, "a")
    .replace(/[ö]/g, "o")
    .replace(/[ü]/g, "u")
    .replace(/[ß]/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function uploadImages(page: Page, imagePaths: string[]) {
  if (imagePaths.length === 0) return false;
  const fileInputs = await page.locator("input[type='file']").all();
  for (const input of fileInputs) {
    try {
      await input.setInputFiles(imagePaths);
      return true;
    } catch {
      // Try the next input if Kleinanzeigen keeps multiple file controls on the page.
    }
  }
  return false;
}

export function browserProfileRelativePath() {
  return path.relative(config.rootDir, config.playwrightProfileDir);
}
