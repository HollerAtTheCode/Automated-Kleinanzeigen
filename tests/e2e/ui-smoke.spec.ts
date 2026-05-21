import { test, expect } from "@playwright/test";

test("shows upload workflow entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Kleinanzeigen Verkaufsassistent" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automatische Analyse aktivieren" })).toBeVisible();
  await expect(page.getByText("Produktbilder auswählen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyse starten/ })).toBeDisabled();
});
