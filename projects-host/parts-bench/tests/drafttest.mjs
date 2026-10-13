import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const ctx = await b.newContext({viewport:{width:1440,height:950}});
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const url='file:///home/claude/prev/index.html';
await p.goto(url); await p.waitForTimeout(600);

// 1. start a new spool, type, close without saving
await p.click('#btn-add'); await p.waitForTimeout(250);
await p.click('[data-k="brand"]'); await p.keyboard.type('Polymaker', {delay:12});
await p.click('[data-k="colorName"]'); await p.keyboard.type('Galaxy Black', {delay:12});
await p.click('[data-c="nozzle_temperature"]'); await p.keyboard.type('258', {delay:12});
await p.waitForTimeout(350);
await p.click('#dr-close'); await p.waitForTimeout(400);
const afterClose = await p.evaluate(()=>({
  rows:[...document.querySelectorAll('#rows tr')].map(r=>r.textContent.replace(/\s+/g,' ').trim().slice(0,60)),
  clearBtn:document.querySelector('#btn-cleardrafts').textContent,
  count:document.querySelector('#count').textContent }));
console.log('1. after closing without saving:');
console.log('   rows:', JSON.stringify(afterClose.rows));
console.log('   count:', afterClose.count, '| clear:', afterClose.clearBtn);

// 2. reopen the draft row — values still there?
await p.click('#rows tr'); await p.waitForTimeout(350);
const reopened = await p.evaluate(()=>({
  brand:document.querySelector('[data-k="brand"]').value,
  colour:document.querySelector('[data-k="colorName"]').value,
  temp:document.querySelector('[data-c="nozzle_temperature"]').value,
  chip:getComputedStyle(document.querySelector('#dr-draftchip')).display }));
console.log('2. reopened draft:', JSON.stringify(reopened));

// 3. add a SECOND spool while the first is still pending
await p.click('#dr-close'); await p.waitForTimeout(250);
await p.click('#btn-add'); await p.waitForTimeout(250);
await p.click('[data-k="brand"]'); await p.keyboard.type('Bambu Lab', {delay:12});
await p.waitForTimeout(350);
await p.click('#dr-close'); await p.waitForTimeout(400);
const two = await p.evaluate(()=>({rows:document.querySelectorAll('#rows tr').length,
  clear:document.querySelector('#btn-cleardrafts').textContent}));
console.log('3. two pending drafts coexist:', JSON.stringify(two));

// 4. full page reload — do drafts survive?
await p.reload(); await p.waitForTimeout(800);
const afterReload = await p.evaluate(()=>({
  rows:[...document.querySelectorAll('#rows tr')].map(r=>r.textContent.replace(/\s+/g,' ').trim().slice(0,46)),
  clear:document.querySelector('#btn-cleardrafts').textContent }));
console.log('4. after page reload:', JSON.stringify(afterReload));

// 5. save one draft -> becomes a real spool, draft row disappears
await p.click('#rows tr'); await p.waitForTimeout(300);
await p.click('#dr-save'); await p.waitForTimeout(500);
const afterSave = await p.evaluate(()=>({
  rows:[...document.querySelectorAll('#rows tr')].map(r=>r.textContent.replace(/\s+/g,' ').trim().slice(0,46)),
  clear:document.querySelector('#btn-cleardrafts').textContent,
  spools:spools.length }));
console.log('5. after saving one:', JSON.stringify(afterSave));

// 6. clear all drafts
p.on('dialog', d=>d.accept());
await p.click('#btn-cleardrafts'); await p.waitForTimeout(400);
const cleared = await p.evaluate(()=>({rows:document.querySelectorAll('#rows tr').length,
  clearHidden:document.querySelector('#btn-cleardrafts').style.display==='none',
  spools:spools.length}));
console.log('6. after clear all:', JSON.stringify(cleared));

console.log('\nerrors:', errs.length? errs : 'none');
await b.close();
