import { test, expect } from "@playwright/test";

test("five-minute view-6 / 30-entity performance baseline", async ({
  page,
}) => {
  test.skip(process.env.PERF !== "1", "Run explicitly with npm run test:perf");
  test.setTimeout(360000);
  await page.goto("./");
  await page.getByRole("button", { name: "进入世界" }).click();
  await page.waitForTimeout(300000);
  const result = await page.evaluate(() => window.__tidalcraft.snapshot());
  await test
    .info()
    .attach("performance.json", {
      body: Buffer.from(JSON.stringify(result, null, 2)),
      contentType: "application/json",
    });
  expect(result).toMatchObject({ chunks: 169, entities: 30 });
  expect(result.averageFps).toBeGreaterThanOrEqual(30);
  expect(result.p95FrameMs).toBeLessThanOrEqual(50);
});
