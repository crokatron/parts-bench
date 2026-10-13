import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await (await b.newContext({viewport:{width:1460,height:1000}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(700);

// a spool to reference
await p.click('#btn-add'); await p.waitForTimeout(250);
await p.click('[data-k="brand"]'); await p.keyboard.type('Bambu Lab',{delay:8});
await p.click('[data-k="colorName"]'); await p.keyboard.type('Matte Charcoal',{delay:8});
await p.click('[data-k="batch"]'); await p.keyboard.type('GFA01-2612B',{delay:8});
await p.waitForTimeout(250); await p.click('#dr-save'); await p.waitForTimeout(400);

// edit it so history has a diff to show
await p.click('#rows tr'); await p.waitForTimeout(300);
await p.click('[data-c="nozzle_temperature"]'); await p.keyboard.type('228',{delay:8});
await p.waitForTimeout(200); await p.click('#dr-save'); await p.waitForTimeout(400);

// a part with a 3MF version
await p.click('[data-view="parts"]'); await p.waitForTimeout(250);
await p.click('#btn-addpart'); await p.waitForTimeout(250);
await p.click('[data-pt="versions"]'); await p.waitForTimeout(200);
await p.setInputFiles('#pt-file','/home/claude/fixtures/bracket.3mf'); await p.waitForTimeout(1600);

// log a print against it
await p.click('[data-pt="overview"]'); await p.waitForTimeout(300);
await p.click('#pt-logprint'); await p.waitForTimeout(350);
await p.selectOption('#pr-spool', await p.evaluate(()=>spools[0].id));
await p.selectOption('#pr-outcome','mixed');
await p.fill('#pr-weight','23.4'); await p.fill('#pr-dur','91');
await p.click('#pr-notes'); await p.keyboard.type('Slight corner lift on the long edge.',{delay:5});
await p.waitForTimeout(200);
await p.click('#dr-save'); await p.waitForTimeout(600);

const pr = await p.evaluate(()=>{
  const r = prints[0];
  return {version:(versions[r.partId]||[]).find(v=>v.id===r.versionId)?.label,
          spool:r.spoolId? 'linked':'none', outcome:r.outcome, weight:r.weightG, dur:r.durationMin,
          snapshotKeys:r.snapshot? Object.keys(r.snapshot).length:0,
          snapshot:r.snapshot};
});
console.log('-- print record --');
console.log(JSON.stringify(pr,null,1).slice(0,760));

// history
await p.click('#dr-close'); await p.waitForTimeout(250);
await p.click('[data-view="history"]'); await p.waitForTimeout(400);
console.log('\n-- history --');
console.log(await p.evaluate(()=>({
  entries:document.querySelectorAll('#hist-out .tl').length,
  count:document.querySelector('#hcount').textContent,
  firstChange:[...document.querySelectorAll('#hist-out .chg')].slice(0,3).map(c=>c.textContent.replace(/\s+/g,' ').trim())
})));

// verify a file against the fingerprints
await p.click('[data-view="parts"]'); await p.waitForTimeout(250);
await p.click('#btn-verify'); await p.waitForTimeout(250);
await p.setInputFiles('#verify-file','/home/claude/fixtures/bracket.3mf'); await p.waitForTimeout(600);
console.log('\nverify match  :', (await p.textContent('#verify-out')).replace(/\s+/g,' ').trim().slice(0,110));
await p.setInputFiles('#verify-file','/home/claude/fixtures/cube20.stl'); await p.waitForTimeout(600);
console.log('verify no-match:', (await p.textContent('#verify-out')).replace(/\s+/g,' ').trim().slice(0,110));

const ov = await p.evaluate(()=>document.documentElement.scrollWidth - window.innerWidth);
console.log('\nhorizontal overflow:', ov);
await p.screenshot({path:'parts-view.png'});
console.log('errors:', errs.length? errs.slice(0,4):'none');
await b.close();
