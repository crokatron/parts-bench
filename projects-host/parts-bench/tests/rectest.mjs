import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await b.newPage({viewport:{width:1440,height:950}});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(600);
await p.click('[data-view="recommend"]'); await p.waitForTimeout(400);
async function set(id,val){
  await p.fill('#'+id,''); await p.click('#'+id); await p.keyboard.type(String(val),{delay:12});
  await p.waitForTimeout(120);
  return p.evaluate(i=>{const el=document.getElementById(i);const h=el.closest('label.f');
    const m=h.querySelector(':scope > .vmsg');
    return {cls:el.classList.contains('bad')?'crit':el.classList.contains('caution')?'warn':'ok',
            msg:(m&&m.textContent)||'', focused:document.activeElement===el};},id);
}
for(const [lbl,id,v,want] of [
  ['layer 0.20 on 0.4','r-lh',0.20,'ok'],
  ['layer 0.35 on 0.4','r-lh',0.35,'crit'],
  ['layer 0.28 on 0.4','r-lh',0.28,'warn'],
  ['width 0.42 on 0.4','r-lw',0.42,'ok'],
  ['width 0.30 on 0.4','r-lw',0.30,'crit'],
  ['width 0.70 on 0.4','r-lw',0.70,'warn'],
  ['height 60 on X1C','r-h',60,'ok'],
  ['height 400 on X1C','r-h',400,'crit'],
]){
  const r = await set(id,v);
  console.log(((r.cls===want&&r.focused)?'  ok  ':'  FAIL').padEnd(7), lbl.padEnd(20), r.cls.padEnd(5),'|',r.msg.slice(0,68));
}
console.log('errors:', errs.length? errs:'none');
await b.close();
