import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
const fails=[]; p.on('requestfailed',r=>{ if(!r.url().includes('fonts.g')) fails.push(r.url()+' '+r.failure()?.errorText); });

await p.goto('http://127.0.0.1:8771/'); await p.waitForTimeout(1500);
console.log('header status :', await p.textContent('#syncmsg'));
console.log('tabs          :', (await p.$$eval('.tab', ts=>ts.map(t=>t.textContent))).join(' · '));

await p.click('[data-view="parts"]'); await p.waitForTimeout(600);
console.log('parts cards   :', await p.$$eval('.partcard', c=>c.map(x=>x.querySelector('b').textContent)));
const img = await p.$eval('.partcard img', i=>({src:i.getAttribute('src'), w:i.naturalWidth, h:i.naturalHeight}));
console.log('card thumbnail:', img);

// open a part, check versions and slicer settings
await p.click('.partcard'); await p.waitForTimeout(700);
console.log('drawer title  :', await p.textContent('#dr-title'));
console.log('path hint     :', (await p.textContent('.dbody .hint')).trim().slice(0,80));
await p.click('[data-pt="versions"]'); await p.waitForTimeout(500);
console.log('versions      :', await p.$$eval('.verrow', r=>r.length));
await p.click('[data-vset]'); await p.waitForTimeout(300);
console.log('slicer rows   :', await p.$$eval('.paramtable tr', r=>r.length));

// upload through the browser
await p.setInputFiles('#pt-file','/home/claude/fixtures/plain.3mf'); await p.waitForTimeout(2500);
console.log('after upload  :', await p.$$eval('.verrow', r=>r.length), 'versions');

// log a print
await p.click('[data-pt="overview"]'); await p.waitForTimeout(400);
await p.click('#pt-logprint'); await p.waitForTimeout(400);
await p.fill('#pr-weight','23.4'); await p.selectOption('#pr-outcome','mixed');
await p.click('#dr-save'); await p.waitForTimeout(900);
console.log('prints logged :', await p.evaluate(()=>prints.length), '| snapshot keys',
  await p.evaluate(()=>Object.keys(prints[0].snapshot||{}).length));

// storage view
await p.click('#dr-close'); await p.waitForTimeout(300);
await p.click('[data-view="storage"]'); await p.waitForTimeout(900);
console.log('storage root  :', (await p.textContent('#store-out .ro .val')).trim());
console.log('categories    :', await p.$$eval('#store-out tbody tr', r=>r.map(x=>x.cells[0].textContent)));

// history
await p.click('[data-view="history"]'); await p.waitForTimeout(600);
console.log('history rows  :', await p.$$eval('#hist-out .tl', r=>r.length), '|', await p.textContent('#hcount'));

// the physics engine still works
await p.click('[data-view="recommend"]'); await p.waitForTimeout(700);
console.log('recommend     :', await p.$$eval('#rec-out .ro .val', v=>v.slice(0,4).map(x=>x.textContent.trim())));

const ov = await p.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
console.log('\noverflow:', ov, '| page errors:', errs.length? errs.slice(0,3):'none', '| failed requests:', fails.length? fails.slice(0,3):'none');
await p.click('[data-view="parts"]'); await p.waitForTimeout(500);
await p.screenshot({path:'pb-parts.png'});
await b.close();
