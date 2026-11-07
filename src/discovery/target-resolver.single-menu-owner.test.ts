import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { resolveActionTarget } from "./target-resolver";
import { resolveSingleMenuOwner } from "./single-menu-owner";

test("full resolver resolves nested menuitem and link snapshot entries", async () => {
 const browser = await chromium.launch();
 try {
 const page = await browser.newPage();
 await page.setContent('<button>Add address</button><p>Home</p><ul role="menu"><li role="menuitem" aria-label="Home"><div><a><span>Home</span></a></div></li></ul>');
 assert.ok(await resolveSingleMenuOwner(page, 'Home'));
 const snapshot: any = { version:'1.0', capturedAt:new Date().toISOString(), url:page.url(), title:'fixture', summary:{totalElements:2}, elements:[
 {id:'link',type:'link',text:'Home',tagName:'a',visible:true,candidateLocators:[{strategy:'text',value:'Home',exact:false,confidence:0.75}],dataHints:[],actionability:'NATIVE_ACTIONABLE',actionOwner:true},
 {id:'item',type:'text',text:'Home',name:'Home',role:'menuitem',ariaLabel:'Home',tagName:'li',visible:true,candidateLocators:[{strategy:'role',role:'menuitem',name:'Home',exact:false,confidence:0.9}],dataHints:[],actionability:'SEMANTIC_ACTIONABLE',actionOwner:true}
 ]};
 const result = await resolveActionTarget(page,snapshot,'Home',{previousTarget:'Add address',nextTarget:'Street'});
 assert.equal(result.status,'resolved', JSON.stringify({status:result.status,reason:result.matchReason}));
 } finally { await browser.close(); }
});
