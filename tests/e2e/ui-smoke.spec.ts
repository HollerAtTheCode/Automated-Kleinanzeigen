import { test, expect } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

test("shows upload workflow entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kleinanzeigen Verkaufsassistent" })).toBeVisible();
  await expect(page.getByText("Produktbilder auswählen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyse starten/ })).toBeDisabled();
});

test("asks for required listing details after analysis", async ({ page }) => {
  const imagePath = path.join(os.tmpdir(), `automated-kleinanzeigen-${Date.now()}.png`);
  await fs.writeFile(
    imagePath,
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lHqY7wAAAABJRU5ErkJggg==", "base64")
  );

  await page.goto("/");
  await page.locator("input#images").setInputFiles(imagePath);
  await page.getByRole("button", { name: /Analyse starten/ }).click();

  await expect(page.getByRole("heading", { name: "Produktangaben" })).toBeVisible();
  await expect(page.getByLabel("Produkt")).toBeVisible();
  await expect(page.getByLabel("Zustand")).toBeVisible();
  await expect(page.getByLabel("Kategorie")).toBeVisible();

  await page.getByRole("button", { name: /Vergleichsangebote finden/ }).click();
  await expect(page.getByText("Bitte fülle Produkt, Zustand und Kategorie aus.")).toBeVisible();
});
