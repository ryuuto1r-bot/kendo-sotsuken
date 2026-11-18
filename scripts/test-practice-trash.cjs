const {chromium} = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const br = await chromium.launch({channel:'chrome', headless:true});
  try {
    for (const width of [1200,390]) {
      const ctx = await br.newContext({viewport:{width,height:850}, serviceWorkers:'block'});
      const page = await ctx.newPage(); page.setDefaultTimeout(9000);
      await page.route('**/*',route=>route.request().url().startsWith('http://127.0.0.1:4174/') ? route.continue() : route.abort());
      await page.addInitScript(()=>{
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded','1');
        localStorage.setItem('kendoRecords', JSON.stringify([1,2,3].map(id=>({id,recordType:id===2?'formal':'realtime', timeMs:300+id, rightAng:130,torsoAng:8, recordedAt:'2026-11-01T12:00:00Z'}))));
        localStorage.setItem('kendoVideoEditSnapshots','[]');
      });
      await page.goto('http://127.0.0.1:4174/index.html',{waitUntil:'domcontentloaded'});
      const ids=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('kendoRecords')||'[]').map(r=>r.id));
      await page.locator('#tabBtn-details').click();
      await page.locator('#detailRecordFilterSelect').selectOption('realtime');
      const box=page.locator('#localRecordRemoval'), first=page.locator('#detailRecordsBody [data-practice-delete="1"]');
      await first.click();
      assert.match(await box.innerText(),/記録 #1/);
      assert.equal(await box.locator('button[value=cancel]').evaluate(e=>e===document.activeElement),true);
      await page.keyboard.press('Escape');
      assert.deepEqual(await ids(),[1,2,3]);
      await first.click(); await box.getByText('削除する',{exact:true}).click();
      await first.waitFor({state:'detached'}); assert.deepEqual(await ids(),[2,3]);
      await page.reload({waitUntil:'domcontentloaded'}); assert.deepEqual(await ids(),[2,3]);
      await page.locator('#moreNavMenu summary').click(); await page.locator('#tabBtn-data').click();
      const second=page.locator('#dataRealtimeBody [data-practice-delete="3"]'); await second.click();
      await box.getByText('キャンセル').click(); assert.deepEqual(await ids(),[2,3]);
      await second.click(); await box.getByText('削除する',{exact:true}).click();
      await second.waitFor({state:'detached'}); assert.deepEqual(await ids(),[2]);
      assert.match(await page.locator('#dataRealtimeBody').innerText(),/データなし/);
      assert.equal(await page.locator('#dataFormalBody [data-practice-delete]').count(),0);
      await page.evaluate(()=>window.clearHistory()); await box.getByText('キャンセル').click(); assert.deepEqual(await ids(),[2]);
      await page.evaluate(()=>window.clearHistory()); await box.getByText('削除する',{exact:true}).click();
      await page.waitForFunction(()=>localStorage.getItem('kendoRecords')===null);
      assert.equal(await page.evaluate(()=>localStorage.getItem('kendoVideoEditSnapshots')),'[]');
      console.log('PASS',width,'cancel, local-only one-record removal, reload, last practice record, distinct bulk confirmation, draft retained');
      await ctx.close();
    }
  } finally {await br.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
