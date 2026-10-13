import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await b.newPage({viewport:{width:1440,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(700);
await p.click('#btn-add'); await p.waitForTimeout(300);

async function set(sel, val){
  await p.fill(sel, '');
  if(val!=='') { await p.click(sel); await p.keyboard.type(String(val), {delay:12}); }
  await p.waitForTimeout(90);
  return p.evaluate(s=>{
    const el=document.querySelector(s);
    const host=el.closest('label.f')||el.parentElement;
    const m=host.querySelector(':scope > .vmsg');
    return {cls: el.classList.contains('bad')?'crit':el.classList.contains('caution')?'warn':'ok',
            msg:(m&&m.textContent)||'', focused:document.activeElement===el};
  }, sel);
}
const cases = [
  ['PLA nozzle 220 (normal)', '[data-c="nozzle_temperature"]', 220, 'ok'],
  ['PLA nozzle 260 (hot)',    '[data-c="nozzle_temperature"]', 260, 'warn'],
  ['PLA nozzle 400 (impossible)','[data-c="nozzle_temperature"]', 400, 'crit'],
  ['PLA nozzle "abc"',        '[data-c="nozzle_temperature"]', 'abc', 'crit'],
  ['bed 55 (normal)',         '[data-c="hot_plate_temp"]', 55, 'ok'],
  ['bed 130 (over machine)',  '[data-c="hot_plate_temp"]', 130, 'crit'],
  ['bed 75 (above PLA Tg)',   '[data-c="hot_plate_temp"]', 75, 'warn'],
  ['chamber 80 (over max)',   '[data-c="chamber_temperatures"]', 80, 'crit'],
  ['dry 45 (safe for PLA)',   '[data-c="filament_dev_ams_drying_temperature"]', 45, 'ok'],
  ['dry 70 (welds PLA spool)','[data-c="filament_dev_ams_drying_temperature"]', 70, 'crit'],
  ['flow ratio 1.00',         '[data-c="filament_flow_ratio"]', 1.0, 'ok'],
  ['flow ratio 1.5',          '[data-c="filament_flow_ratio"]', 1.5, 'crit'],
  ['flow ratio 1.08',         '[data-c="filament_flow_ratio"]', 1.08, 'ok'],
  ['retraction 0.8',          '[data-c="filament_retraction_length"]', 0.8, 'ok'],
  ['retraction 5',            '[data-c="filament_retraction_length"]', 5, 'crit'],
  ['fan 120%',                '[data-c="fan_max_speed"]', 120, 'crit'],
  ['MVS 500',                 '[data-c="filament_max_volumetric_speed"]', 500, 'crit'],
  ['MVS 15',                  '[data-c="filament_max_volumetric_speed"]', 15, 'ok'],
  ['shrink 100%',             '[data-c="filament_shrink"]', '100%', 'ok'],
  ['shrink 150%',             '[data-c="filament_shrink"]', '150%', 'crit'],
];
let pass=0;
for (const [label, sel, val, want] of cases){
  const r = await set(sel, val);
  const good = r.cls===want && r.focused;
  if(good) pass++;
  console.log((good?'  ok  ':'  FAIL').padEnd(7), label.padEnd(28), r.cls.padEnd(5), '|', r.msg.slice(0,72));
}
// range coherence
await set('[data-c="nozzle_temperature_range_low"]', 250);
const rl = await p.evaluate(()=>document.querySelector('[data-c="nozzle_temperature_range_low"]').classList.contains('bad'));
console.log('  ' + (rl?'ok  ':'FAIL') + '   range low 250 above high 240 ->', rl?'crit':'not flagged');

const summary = await p.evaluate(()=>({cls:document.querySelector('#v-summary').className, txt:document.querySelector('#v-summary').textContent.trim().slice(0,110), footer:document.querySelector('#dr-vcount').textContent}));
console.log('\nsummary:', JSON.stringify(summary));

// measured tab
await p.click('.dtab[data-t="measured"]'); await p.waitForTimeout(250);
const m1 = await set('[data-mv="value"]', 19);
const m2 = await set('[data-mv="value"]', 90);
const d1 = await set('[data-mo="diameter"]', 1.75);
const d2 = await set('[data-mo="diameter"]', 3.0);
console.log('measured 19 mm3/s ->', m1.cls, '| 90 ->', m2.cls, '|', m2.msg.slice(0,60));
console.log('diameter 1.75 ->', d1.cls, '| 3.0 ->', d2.cls, '|', d2.msg.slice(0,60));

console.log(`\n${pass}/${cases.length} core cases pass`);
console.log('errors:', errs.length? errs : 'none');
await b.close();
