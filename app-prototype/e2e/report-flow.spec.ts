import { test, expect } from "@playwright/test";
import { FREE_STORES } from "../lib/free-stores";

// Flow is landing -> running -> report (free mode, no AI, per decision 007).
for (const store of FREE_STORES) {
  test(`${store.label}: landing -> running -> report`, async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /see what your competitors/i })).toBeVisible();

    // Landing: use the Demo footer link rather than typing URLs.
    await page.getByRole("button", { name: "Demo" }).click();
    await page.getByRole("button", { name: store.label }).click();

    // Running: shows the step checklist, then auto-advances.
    await expect(page.getByText("Reading your store")).toBeVisible();

    // Report: no confirm step in between.
    await expect(page.getByText(`Prepared for`)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(store.label)).toBeVisible();

    // "Your competitors" row always present, with the demo's baked-in picks.
    await expect(page.getByText("Your competitors", { exact: true })).toBeVisible();
    const competitorCount = store.fixture.competitors.length;
    expect(competitorCount).toBeGreaterThan(0);
    for (const c of store.fixture.competitors) {
      await expect(page.getByText(c.name, { exact: true }).first()).toBeVisible();
    }

    // Summary strip renders. No moves section in free mode.
    await expect(page.getByText("Active ads found")).toBeVisible();

    // Every competitor card is present, collapsed by default.
    for (const c of store.fixture.competitors) {
      await expect(page.getByText(`${c.totalAdsFound} active ads`).first()).toBeVisible();
    }

    await expect(page.getByText(/Built from public information/)).toBeVisible();
    await expect(page.getByText(/Want this tailored to your store/)).toBeVisible();

    // There's an explicit way back to the landing page, and the browser's
    // own back gesture/shortcut works too (not just the button).
    await page.getByRole("button", { name: "Start another report" }).click();
    await expect(page.getByRole("heading", { name: /see what your competitors/i })).toBeVisible();

    await page.getByRole("button", { name: "Demo" }).click();
    await page.getByRole("button", { name: store.label }).click();
    await expect(page.getByText(`Prepared for`)).toBeVisible({ timeout: 10_000 });
    await page.goBack();
    await expect(page.getByRole("heading", { name: /see what your competitors/i })).toBeVisible();
  });
}
