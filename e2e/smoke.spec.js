import { test, expect } from "@playwright/test";

test("loads menu and enters a rendered world without console errors", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator("#menu .logo")).toContainText("TIDALCRAFT");
  await page.screenshot({ path: "docs/evidence/start-menu.png" });
  await expect(page.getByRole("button", { name: "进入世界" })).toBeVisible();
  await page.getByRole("button", { name: "进入世界" }).click();
  await expect(page.locator("#menu")).toHaveClass(/hidden/);
  await expect(page.locator("#world-label")).toContainText("chunks");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "docs/evidence/vertical-slice.png" });
  const render = await page.evaluate(() => window.__tidalcraft.snapshot());
  console.log(`render-sample ${JSON.stringify(render)}`);
  expect(render).toMatchObject({ started: true, chunks: 169, entities: 30 });
  expect(render.instances).toBeGreaterThan(1000);
  expect(render.drawCalls).toBeGreaterThan(0);
  expect(render.triangles).toBeGreaterThan(0);
  expect(render.samples).toBeGreaterThan(10);
  await page.keyboard.press("KeyE");
  await expect(page.locator("#panel")).not.toHaveClass(/hidden/);
  await expect(page.locator("[data-inv]")).toHaveCount(36);
  await page.locator("[data-inv]").nth(1).click({ button: "right" });
  await expect(page.locator("#carried")).toContainText("×16");
  await page.locator("[data-inv]").nth(35).click({ button: "right" });
  await expect(page.locator("#carried")).toContainText("×15");
  await page.locator("#close-panel").click();
  await page.evaluate(() => document.exitPointerLock());
  await page.getByRole("button", { name: "保存" }).click();
  await page.reload();
  await expect(page.locator("#load-note")).toContainText("本地存档");
  await page.getByRole("button", { name: "进入世界" }).click();
  await expect(page.locator("#world-label")).toContainText("169 chunks");
  expect(errors).toEqual([]);
});
