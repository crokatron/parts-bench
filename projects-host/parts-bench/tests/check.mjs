import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const errs=[];
for (const w of [1440, 1180, 1024, 760]) {
  const p = await b.newPage({viewport:{width:w,height:900}});
  p.on('pageerror',e=>errs.push(w+': '+e));
  await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(700);
  const ov = {};
  for (const v of ['library','recommend','diagnose','compare','hotends','reference']) {
    await p.click(`[data-view="${v}"]`); await p.waitForTimeout(220);
    ov[v] = await p.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
  }
  await p.click('[data-view="library"]'); await p.waitForTimeout(200);
  await p.click('tbody tr'); await p.waitForTimeout(250);
  const pinVisible = await p.isVisible('#dr-pin');
  let pinned={skipped:true};
  if (pinVisible) {
    await p.click('#dr-pin'); await p.waitForTimeout(200);
    await p.click('[data-view="recommend"]'); await p.waitForTimeout(350);
    await p.click('[data-c="deriv"]'); await p.waitForTimeout(150);
    pinned = await p.evaluate(()=>({
      overflow:document.documentElement.scrollWidth-window.innerWidth,
      tabsClickable:document.querySelector('.tab').getBoundingClientRect().right < document.querySelector('.drawer').getBoundingClientRect().left,
      derivHidden:getComputedStyle(document.querySelector('[data-panel="deriv"] .body')).display==='none',
      btn:document.querySelector('[data-c="deriv"]').textContent }));
  }
  console.log(String(w).padStart(5)+'px  overflow', JSON.stringify(ov), ' pinBtn:', pinVisible, ' pinned:', JSON.stringify(pinned));
  await p.close();
}
console.log('errors:', errs.length? errs : 'none');
await b.close();
