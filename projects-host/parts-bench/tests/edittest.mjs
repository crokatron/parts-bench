import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await (await b.newContext({viewport:{width:1440,height:950}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(600);

// create and save a spool
await p.click('#btn-add'); await p.waitForTimeout(200);
await p.click('[data-k="brand"]'); await p.keyboard.type('Bambu Lab',{delay:10});
await p.click('[data-k="colorName"]'); await p.keyboard.type('Matte Charcoal',{delay:10});
await p.waitForTimeout(300);
await p.click('#dr-save'); await p.waitForTimeout(400);

// edit it, then close without saving
await p.click('#rows tr'); await p.waitForTimeout(300);
await p.click('[data-k="colorName"]'); await p.keyboard.press('Control+a');
await p.keyboard.type('Basalt Grey',{delay:10});
await p.click('[data-c="filament_flow_ratio"]'); await p.keyboard.type('0.97',{delay:10});
await p.waitForTimeout(350);
await p.click('#dr-close'); await p.waitForTimeout(400);
console.log('edited then closed  :', await p.evaluate(()=>({
  row:document.querySelector('#rows tr').textContent.replace(/\s+/g,' ').trim().slice(0,64),
  savedValue: spools[0].colorName })));

// reopen: edits present
await p.click('#rows tr'); await p.waitForTimeout(300);
console.log('reopened            :', await p.evaluate(()=>({
  colour:document.querySelector('[data-k="colorName"]').value,
  flow:document.querySelector('[data-c="filament_flow_ratio"]').value,
  discardShown:getComputedStyle(document.querySelector('#dr-discard')).display })));

// discard -> reverts to saved
await p.click('#dr-discard'); await p.waitForTimeout(400);
console.log('after discard       :', await p.evaluate(()=>({
  colour:document.querySelector('[data-k="colorName"]').value,
  flow:document.querySelector('[data-c="filament_flow_ratio"]').value,
  row:document.querySelector('#rows tr').textContent.replace(/\s+/g,' ').trim().slice(0,50) })));

// pinned: add a spool while browsing the library
await p.click('#dr-close'); await p.waitForTimeout(200);
await p.click('#btn-add'); await p.waitForTimeout(250);
await p.click('#dr-pin'); await p.waitForTimeout(250);
await p.click('[data-k="brand"]'); await p.keyboard.type('Polymaker',{delay:10});
await p.waitForTimeout(200);
const rowBox = await p.evaluate(()=>{
  const r=document.querySelector('#rows tr'); const b=r.getBoundingClientRect();
  const dr=document.querySelector('.drawer').getBoundingClientRect();
  return {rowVisible:b.right < dr.left, rows:document.querySelectorAll('#rows tr').length};
});
console.log('pinned while adding :', JSON.stringify(rowBox));
await p.click('#rows tr'); await p.waitForTimeout(350);   // browse to an existing spool
await p.click('#btn-add'); await p.waitForTimeout(300);   // hmm: returns to a NEW draft
console.log('draft kept after browsing away:', await p.evaluate(()=>({
  drafts:Object.keys(drafts).length,
  pending:Object.values(drafts).filter(d=>d._pending).map(d=>d.brand) })));
console.log('\nerrors:', errs.length? errs:'none');
await b.close();
