import { expect, test } from "@playwright/test";

// The 90-second demo path: home → filter → detail → German → pipeline.
test("visitor can search, open a listing, switch to German and view the pipeline", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByText("Synthetic listings")).toBeVisible();

  await page.getByRole("link", { name: "Properties", exact: true }).first().click();
  await expect(page).toHaveURL(/\/en\/properties/);
  if (isMobile) await page.getByRole("button", { name: "Show filters" }).click();
  await page.getByLabel("Region").selectOption("Alicante");
  await page.getByLabel("Min bedrooms").selectOption("3");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(/region=Alicante/);
  await expect(page).toHaveURL(/minBeds=3/);

  // Filters survive a reload because they live in the URL.
  await page.reload();
  await expect(page.getByLabel("Region")).toHaveValue("Alicante");
  const cards = page.locator("article");
  await expect(cards.first()).toBeVisible();
  for (const text of await cards.locator("p").filter({ hasText: /^Alicante/ }).allTextContents()) {
    expect(text).toContain("Alicante");
  }

  await cards.first().locator("a").click();
  await expect(page).toHaveURL(/\/en\/properties\/[a-z0-9-]+$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/in /);
  const slug = new URL(page.url()).pathname.split("/").pop();

  await page.getByRole("link", { name: "de", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/de/properties/${slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/ in /);
  await expect(page.getByText("Eckdaten")).toBeVisible();

  await page.goto("/de/demo/pipeline");
  await expect(page.getByText("SYNTHETISCHE DEMO-DATEN")).toBeVisible();
  await expect(page.getByRole("table")).toBeVisible();
});

test("unknown listing shows a not-found page", async ({ page }) => {
  await page.goto("/en/properties/does-not-exist");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
