import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {createJiraPlaywrightPort,resolveJiraActionTarget,certifyJiraDurableTarget} from './jira-semantic-executor';
import {scanCurrentPage} from '../explorer/page-scanner';

test('equivalent navigation/content links use the unique main landmark across independent routes',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    for(const [label,href] of [['Nueva solicitud','/requests/new'],['Nuevo pedido','#/orders/new']]){
      const page=await browser.newPage();
      await page.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html',body:`<nav><a href="${href}">${label}</a></nav><main><a href="${href}">${label}</a></main>`}));
      await page.goto('https://fixture.test/');
      const result=await resolveJiraActionTarget(page,await scanCurrentPage(page),label);
      assert.equal(result.status,'resolved');
      assert.equal(result.matchReason,'jira_equivalent_destination_in_main');
      const durable=await certifyJiraDurableTarget(page,result.locator!);
      assert.equal(durable.strategy,'css');
      assert.equal(await page.locator(durable.value!).count(),1);
      assert.equal(await page.locator(durable.value!).evaluate(element=>!!element.closest('main')),true);
      await createJiraPlaywrightPort(page,'https://fixture.test').act({index:1,action:'click'},label);
      assert.ok(page.url().endsWith(href));
      await page.close();
    }
  } finally {await browser.close();}
});

test('duplicate labels with distinct destinations, handlers, no main identity or multiple main owners stay ambiguous',async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.goto('about:blank');
    for(const html of [
      '<nav><a href="https://fixture.test/one">Abrir</a></nav><main><a href="https://fixture.test/two">Abrir</a></main>',
      '<nav><a href="https://fixture.test/one" onclick="return false">Abrir</a></nav><main><a href="https://fixture.test/one">Abrir</a></main>',
      '<nav><a href="https://fixture.test/one">Abrir</a><a href="https://fixture.test/one">Abrir</a></nav>',
      '<main><a href="https://fixture.test/one">Abrir</a><a href="https://fixture.test/one">Abrir</a></main>',
      '<nav><a href="#">Abrir</a></nav><main><a href="#">Abrir</a></main>',
      '<nav><a href="https://fixture.test/one" target="_blank">Abrir</a></nav><main><a href="https://fixture.test/one">Abrir</a></main>',
    ]){
      await page.setContent(html);
      const result=await resolveJiraActionTarget(page,await scanCurrentPage(page),'Abrir');
      assert.equal(result.status,'ambiguous');
    }
  } finally {await browser.close();}
});
