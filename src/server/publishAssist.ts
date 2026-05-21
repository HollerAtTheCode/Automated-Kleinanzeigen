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
    await selectCategory(page, draft.categoryHint);
    await uploadImages(page, orderedImagePaths(images, draft.imageOrder));
    await selectPriceType(page, draft.priceType);

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
        `li:has-text('${targetLabel}')`
      ])
    ) {
      return verifyPriceType(page, targetValue, targetLabel);
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
    return verifyPriceType(page, targetValue, targetLabel);
  }

  for (const text of [targetLabel, priceType === "negotiable" ? "VB" : "Festpreis"]) {
    if (await clickFirstAvailable(page, [`button:has-text('${text}')`, `[role='option']:has-text('${text}')`, `text=${text}`])) {
      return verifyPriceType(page, targetValue, targetLabel);
    }
  }

  return setPriceTypeFallback(page, targetValue, targetLabel);
}

async function selectCategory(page: Page, categoryHint?: string) {
  const categoryOptions = await page.locator("input[type='radio']").evaluateAll((nodes) =>
    nodes.map((node, index) => {
      const input = node as HTMLInputElement;
      const label = input.closest("label");
      const row = input.parentElement;
      return {
        index,
        id: input.id,
        name: input.name,
        value: input.value,
        checked: input.checked,
        text: (label?.textContent ?? row?.textContent ?? "").replace(/\s+/g, " ").trim()
      };
    })
  );
  const candidates = categoryOptions.filter((option) => option.text.includes("→"));
  const wantedTokens = expandCategoryTokens(normalizeCategoryText(categoryHint ?? ""))
    .split(" ")
    .filter((token) => token.length > 3 && !["elektronik", "zubehor", "weitere"].includes(token));
  const ranked = candidates
    .map((option) => ({
      ...option,
      score: wantedTokens.filter((token) => expandCategoryTokens(normalizeCategoryText(option.text)).includes(token)).length
    }))
    .sort((a, b) => b.score - a.score);
  const selected = ranked[0];
  if (!selected || selected.score === 0) return false;
  return page.evaluate((target) => {
    const radios = [...document.querySelectorAll<HTMLInputElement>("input[type='radio']")];
    const radio = radios[target.index];
    if (!radio) return false;
    radio.checked = true;
    radio.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    radio.closest("label")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }, selected);
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

function expandCategoryTokens(value: string) {
  const tokens = value.split(" ").filter(Boolean);
  const expanded = new Set(tokens);
  for (const token of tokens) {
    if (token.endsWith("s") && token.length > 4) expanded.add(token.slice(0, -1));
    if (token === "kameras" || token === "kamera") {
      expanded.add("foto");
      expanded.add("kamera");
      expanded.add("kameras");
    }
    if (token === "camcorder" || token === "actioncams" || token === "actioncam") {
      expanded.add("foto");
      expanded.add("kamera");
    }
  }
  return [...expanded].join(" ");
}

async function uploadImages(page: Page, imagePaths: string[]) {
  if (imagePaths.length === 0) return false;
  await page.waitForTimeout(500);
  const fileInputs = await page.locator("input[type='file']").all();
  for (const input of fileInputs) {
    try {
      await input.setInputFiles(imagePaths);
      await page.waitForTimeout(1000);
      return true;
    } catch {
      // Try the next input if Kleinanzeigen keeps multiple file controls on the page.
    }
  }
  return false;
}

async function verifyPriceType(page: Page, targetValue: string, targetLabel: string) {
  await page.waitForTimeout(250);
  const state = await page.evaluate(() => ({
    value: document.querySelector<HTMLInputElement>("input[name='priceType']")?.value ?? "",
    label: document.querySelector<HTMLElement>("#ad-price-type-selected-option")?.textContent?.trim() ?? ""
  }));
  if (state.value === targetValue || state.label === targetLabel) return true;
  return setPriceTypeFallback(page, targetValue, targetLabel);
}

async function setPriceTypeFallback(page: Page, targetValue: string, targetLabel: string) {
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

export function browserProfileRelativePath() {
  return path.relative(config.rootDir, config.playwrightProfileDir);
}
