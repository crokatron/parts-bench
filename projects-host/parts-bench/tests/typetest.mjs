import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await b.newPage({viewport:{width:1440,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(700);

await p.click('#btn-add'); await p.waitForTimeout(300);

async function typeInto(sel, text, label){
  await p.click(sel);
  await p.keyboard.type(text, {delay:35});
  const r = await p.evaluate(s=>{
    const el=document.querySelector(s);
    return {value:el.value, focused:document.activeElement===el};
  }, sel);
  console.log(label.padEnd(26), JSON.stringify(r), r.value===text && r.focused ? 'PASS':'*** FAIL ***');
  return r.value===text && r.focused;
}

let ok = true;
ok &= await typeInto('[data-k="brand"]', 'Polymaker Industrial', 'brand');
ok &= await typeInto('[data-k="colorName"]', 'Galaxy Black', 'colour name');
ok &= await typeInto('[data-k="batch"]', 'PM-ASA-2605-B', 'batch');
ok &= await typeInto('[data-c="nozzle_temperature"]', '265', 'core: nozzle temp');
ok &= await typeInto('[data-k="notes"]', 'Second lot, runs hotter', 'notes');

// material select should still rebuild the drawer (placeholders change)
await p.selectOption('[data-k="type"]', 'ASA'); await p.waitForTimeout(250);
const afterType = await p.evaluate(()=>({
  brand:document.querySelector('[data-k="brand"]').value,
  ph:document.querySelector('[data-c="nozzle_temperature"]').placeholder,
  title:document.querySelector('#dr-title').textContent }));
console.log('after material change  ', JSON.stringify(afterType));

// advanced tab
await p.click('.dtab[data-t="advanced"]'); await p.waitForTimeout(200);
await p.selectOption('#adv-pick', 'filament_ramming_volumetric_speed');
await p.click('#adv-add'); await p.waitForTimeout(200);
ok &= await typeInto('[data-a="filament_ramming_volumetric_speed"]', '18.5', 'advanced key value');

// measured tab: this one used a 500 ms debounced rebuild
await p.click('.dtab[data-t="measured"]'); await p.waitForTimeout(200);
await p.click('[data-mv="value"]');
await p.keyboard.type('2', {delay:30}); await p.waitForTimeout(700);  // pause past the old debounce
await p.keyboard.type('4.6', {delay:30});
const mv = await p.evaluate(()=>({value:document.querySelector('[data-mv="value"]').value,
  focused:document.activeElement===document.querySelector('[data-mv="value"]'),
  factor:(document.querySelector('#mv-factor')||{}).textContent||'',
  rows:document.querySelectorAll('#mv-table tbody tr').length}));
console.log('measured (paused mid-type)'.padEnd(26), JSON.stringify(mv), mv.value==='24.6'&&mv.focused?'PASS':'*** FAIL ***');
ok &= (mv.value==='24.6' && mv.focused);

console.log('\nerrors:', errs.length? errs : 'none');
console.log(ok ? 'ALL TYPING TESTS PASS' : 'FAILURES PRESENT');
await b.close();
