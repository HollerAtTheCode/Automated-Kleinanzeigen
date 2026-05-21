import { test, expect } from "@playwright/test";

test("shows upload workflow entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Lokaler Kleinanzeigen-Entwurf" })).toBeVisible();
  await expect(page.getByText("Produktbilder auswaehlen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Analyse starten/ })).toBeDisabled();
});
