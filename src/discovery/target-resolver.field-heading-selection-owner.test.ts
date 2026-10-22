import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";

test("custom selection trigger binds to the unique observed field heading, not its sibling field", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section>
          <h2>Cuenta Origen</h2>
          <div class="field-control">
            <button type="button" aria-expanded="false">Seleccione una Cuenta</button>
            <div class="options" hidden><button type="button" role="option">Cuenta Corriente</button><button type="button" role="option">Cuenta de Ahorro</button></div>
          </div>
        </section>
        <section>
          <h2>Cuenta Destino</h2>
          <div class="field-control">
            <button type="button" aria-expanded="false">Seleccione una Cuenta</button>
            <div class="options" hidden><button type="button" role="option">Cuenta Corriente</button><button type="button" role="option">Cuenta de Ahorro</button></div>
          </div>
        </section>
      </main>
      <script>
        for (const button of document.querySelectorAll('.field-control > button')) {
          const options = button.nextElementSibling;
          button.addEventListener('click', () => { options.hidden = false; button.setAttribute('aria-expanded', 'true'); });
          for (const option of options.querySelectorAll('[role="option"]')) {
            option.addEventListener('click', () => {
              button.textContent = option.textContent;
              button.setAttribute('aria-expanded', 'false');
              options.hidden = true;
            });
          }
        }
      </script>
    `);

    const result = await resolveActionTarget(page, { elements: [] } as any, "Cuenta de origen", {
      actionType: "action_select",
      selectionField: "Cuenta de origen",
      selectionValue: "Cuenta Corriente",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    const originSection = page.getByRole("heading", { name: "Cuenta Origen" }).locator("xpath=..");
    const destinationSection = page.getByRole("heading", { name: "Cuenta Destino" }).locator("xpath=..");
    assert.match(await originSection.getByRole("button").innerText(), /Cuenta Corriente/);
    assert.equal(await destinationSection.getByRole("button").innerText(), "Seleccione una Cuenta");
  } finally {
    await browser.close();
  }
});

test("duplicate matching field headings do not certify a selection owner", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section><h2>Cuenta Origen</h2><button>Seleccione una Cuenta</button></section>
      <section><h2>Cuenta de origen</h2><button>Seleccione una Cuenta</button></section>
    `);
    const result = await resolveActionTarget(page, { elements: [] } as any, "Cuenta de origen", {
      actionType: "action_select",
      selectionField: "Cuenta de origen",
      selectionValue: "Cuenta Corriente",
    });
    assert.equal(result.status, "not_found");
    assert.equal(result.selectionDiagnostics?.failureReason, "selection_owner_unresolved");
  } finally {
    await browser.close();
  }
});

test("plain visible field labels bind only their unique focusable custom selection control", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section class="field">
          <span>Cuenta Origen</span>
          <div class="selector" tabindex="0">Seleccione una Cuenta <span>Balance Disponible</span></div>
        </section>
        <section class="field">
          <span>Cuenta Destino</span>
          <div class="selector" tabindex="0">Seleccione una Cuenta <span>Balance Disponible</span></div>
        </section>
        <div class="options" role="listbox" hidden><div role="option">Cuenta Corriente</div><div role="option">Cuenta de Ahorro</div></div>
      </main>
      <script>
        for (const selector of document.querySelectorAll('.selector')) {
          selector.addEventListener('click', () => { document.querySelector('.options').hidden = false; });
        }
        for (const option of document.querySelectorAll('[role="option"]')) {
          option.addEventListener('click', () => {
            document.querySelector('.field:first-child .selector').textContent = option.textContent;
            document.querySelector('.options').hidden = true;
          });
        }
      </script>
    `);

    const result = await resolveActionTarget(page, { elements: [] } as any, "Cuenta de origen", {
      actionType: "action_select",
      selectionField: "Cuenta de origen",
      selectionValue: "Cuenta Corriente",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.selectionApplied, true);
    assert.equal(await page.locator(".field:first-child .selector").innerText(), "Cuenta Corriente");
    assert.match(await page.locator(".field:nth-child(2) .selector").innerText(), /Seleccione una Cuenta/);
  } finally {
    await browser.close();
  }
});

test("authored selects associate visible peer captions across shared form wrappers and verify both fields", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const labels of [["Cuenta Origen", "Cuenta Destino", "Cuenta de origen", "Cuenta de destino"], ["Delivery Method", "Billing Method", "Delivery method", "Billing method"]]) {
      await page.setContent(`
        <div hidden><span class="caption">${labels[0]}</span><span class="caption">${labels[1]}</span></div>
        <main style="width:900px">
          <span class="caption">${labels[0]}</span><div><div class="selector" tabindex="0" style="width:850px;height:70px">Choose an option</div></div>
          <span class="caption">${labels[1]}</span><div><div class="selector" tabindex="0" style="width:850px;height:70px">Choose an option</div></div>
        </main>
        <div class="portal" hidden><div>Standard</div><div>Express</div></div>
        <script>
          var active;
          document.querySelectorAll('.selector').forEach(control => control.onclick = () => { active = control; document.querySelector('.portal').hidden = false; });
          document.querySelectorAll('.portal > div').forEach(option => option.onclick = () => { active.textContent = option.textContent; document.querySelector('.portal').hidden = true; });
        </script>
      `);
      const controls = page.locator('.selector');
      const origin = await resolveActionTarget(page, { elements: [] } as any, labels[2], { actionType: "action_select", selectionValue: "Standard" });
      assert.equal(origin.status, "resolved");
      assert.equal(origin.selectionApplied, true);
      assert.deepEqual(await controls.allTextContents(), ["Standard", "Choose an option"]);
      const destination = await resolveActionTarget(page, { elements: [] } as any, labels[3], { actionType: "action_select", selectionValue: "Express" });
      assert.equal(destination.selectionApplied, true);
      assert.deepEqual(await controls.allTextContents(), ["Standard", "Express"]);
      const sharedValue = await resolveActionTarget(page, { elements: [] } as any, labels[3], { actionType: "action_select", selectionValue: "Standard" });
      assert.equal(sharedValue.selectionApplied, true, "a value shown in the other field cannot conceal the newly opened option");
      assert.deepEqual(await controls.allTextContents(), ["Standard", "Standard"]);
    }
  } finally { await browser.close(); }
});

test("a caption with multiple actionable custom controls cannot certify an owner", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><span class="caption">Delivery Method</span><div tabindex="0">Choose an option</div><div tabindex="0">Choose an option</div></main>');
    const result = await resolveActionTarget(page, { elements: [] } as any, "Delivery method", { actionType: "action_select", selectionValue: "Express" });
    assert.equal(result.status, "not_found");
    assert.notEqual(result.selectionApplied, true);
  } finally { await browser.close(); }
});

test("a newly opened matching option cannot pass if the owning control does not retain its value", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main><span>Delivery Method</span><div tabindex="0" onclick="document.querySelector('aside').hidden=false">Choose an option</div></main><aside hidden><div onclick="this.parentElement.hidden=true">Express</div></aside>`);
    const result = await resolveActionTarget(page, { elements: [] } as any, "Delivery method", { actionType: "action_select", selectionValue: "Express" });
    assert.notEqual(result.selectionApplied, true);
    assert.equal(await page.locator('main [tabindex]').innerText(), "Choose an option");
  } finally { await browser.close(); }
});

test("composite options allow any available generic type while respecting an explicit identifier", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const mount = async () => page.setContent(`<main><span>Funding Source</span><div tabindex="0" id="owner" onclick="document.querySelector('aside').hidden=false">Choose an option</div></main>
      <aside hidden><div onclick="document.querySelector('#owner').textContent=this.textContent;this.parentElement.hidden=true">Checking / 100001 / USD 10.00</div><div onclick="document.querySelector('#owner').textContent=this.textContent;this.parentElement.hidden=true">Checking / 100002 / USD 20.00</div><div onclick="document.querySelector('#owner').textContent=this.textContent;this.parentElement.hidden=true">Savings / 200001 / USD 30.00</div></aside>`);
    await mount();
    const generic = await resolveActionTarget(page, { elements: [] } as any, "Funding Source", { actionType: "action_select", selectionValue: "Checking" });
    assert.equal(generic.selectionApplied, true);
    assert.equal(generic.selectionDiagnostics?.optionCandidateCount, 2);
    assert.match(await page.locator('#owner').innerText(), /^Checking \/ 100001/);
    await mount();
    const uniqueType = await resolveActionTarget(page, { elements: [] } as any, "Funding Source", { actionType: "action_select", selectionValue: "Savings" });
    assert.equal(uniqueType.selectionApplied, true);
    assert.match(await page.locator('#owner').innerText(), /^Savings \/ 200001/);
    await mount();
    const uniqueIdentifier = await resolveActionTarget(page, { elements: [] } as any, "Funding Source", { actionType: "action_select", selectionValue: "100002" });
    assert.equal(uniqueIdentifier.selectionApplied, true);
    assert.match(await page.locator('#owner').innerText(), /^Checking \/ 100002/);
    await mount();
    await page.locator('aside > div').filter({ hasText: '100001' }).evaluate(element => element.setAttribute('aria-disabled', 'true'));
    const available = await resolveActionTarget(page, { elements: [] } as any, "Funding Source", { actionType: "action_select", selectionValue: "Checking" });
    assert.equal(available.selectionApplied, true);
    assert.match(await page.locator('#owner').innerText(), /^Checking \/ 100002/);
    await mount();
    const missingIdentifier = await resolveActionTarget(page, { elements: [] } as any, "Funding Source", { actionType: "action_select", selectionValue: "999999" });
    assert.notEqual(missingIdentifier.selectionApplied, true);
    assert.equal(await page.locator('#owner').innerText(), "Choose an option");
  } finally { await browser.close(); }
});



test("custom category plural reaches observed popup and owner readback in two vocabularies", async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    for (const [field, requested, observed] of [["Cuenta Destino","Cuenta de Ahorros","Cuenta de Ahorro"],["Delivery Method","Delivery Methods","Delivery Method"]]) {
      await page.setContent(`<main><span>${field}</span><div tabindex="0" id="owner" onclick="document.querySelector('aside').hidden=false">Choose an option</div></main><aside hidden><div onclick="document.querySelector('#owner').textContent=this.textContent;this.parentElement.hidden=true">${observed} / 300001</div></aside>`);
      const result = await resolveActionTarget(page, {elements:[]} as any, field, {actionType:'action_select',selectionValue:requested});
      assert.equal(result.selectionApplied,true,JSON.stringify(result.selectionDiagnostics));
      assert.equal(await page.locator('#owner').innerText(),`${observed} / 300001`);
    }
  } finally {await browser.close();}
});

