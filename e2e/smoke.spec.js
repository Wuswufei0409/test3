import {test,expect} from '@playwright/test';

test('loads menu and enters a rendered world without console errors',async({page})=>{
  const errors=[];page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text())});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('./');
  await expect(page.locator('#menu .logo')).toContainText('TIDALCRAFT');
  await page.screenshot({path:'docs/evidence/start-menu.png'});
  await expect(page.getByRole('button',{name:'进入世界'})).toBeVisible();
  await page.getByRole('button',{name:'进入世界'}).click();
  await expect(page.locator('#menu')).toHaveClass(/hidden/);
  await expect(page.locator('#world-label')).toContainText('chunks');
  await page.waitForTimeout(1500);
  await page.screenshot({path:'docs/evidence/vertical-slice.png'});
  const render=await page.evaluate(()=>window.__tidalcraft.snapshot());
  expect(render).toMatchObject({started:true,chunks:25,entities:30});
  expect(render.instances).toBeGreaterThan(1000);
  expect(render.drawCalls).toBeGreaterThan(0);
  expect(render.triangles).toBeGreaterThan(0);
  expect(render.samples).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
