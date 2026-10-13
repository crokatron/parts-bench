import { chromium } from 'playwright';
const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium'});
const p = await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('file:///home/claude/prev/index.html'); await p.waitForTimeout(800);
console.log('JSZip loaded:', await p.evaluate(()=>typeof JSZip !== 'undefined'));

await p.click('[data-view="parts"]'); await p.waitForTimeout(300);
await p.click('#btn-addpart'); await p.waitForTimeout(300);
await p.click('[data-pt="versions"]'); await p.waitForTimeout(250);

// --- STL: a 20 mm cube must measure 20x20x20 and 8000 mm3 ---
await p.setInputFiles('#pt-file','/home/claude/fixtures/cube20.stl');
await p.waitForTimeout(1500);
console.log('\n-- STL cube20 --');
console.log(await p.evaluate(()=>{
  const v=(versions[state.part.id]||[])[0];
  return {bbox:v.mesh.bbox.map(x=>+x.toFixed(3)), volume_mm3:+v.mesh.volume.toFixed(1),
          tris:v.mesh.triangles, format:v.mesh.format, thumb:v.thumb? v.thumb.slice(0,22)+'…('+v.thumb.length+' chars)':null,
          sha:v.sha256.slice(0,12), bytes:v.sizeBytes};
}));

// --- 3MF Bambu project ---
await p.click('#dr-close'); await p.waitForTimeout(250);
await p.click('#btn-addpart'); await p.waitForTimeout(250);
await p.click('[data-pt="versions"]'); await p.waitForTimeout(200);
await p.setInputFiles('#pt-file','/home/claude/fixtures/bracket.3mf');
await p.waitForTimeout(1800);
console.log('\n-- 3MF Bambu project --');
console.log(await p.evaluate(()=>{
  const v=(versions[state.part.id]||[])[0];
  return {bbox:v.mesh.bbox.map(x=>+x.toFixed(2)), volume_mm3:+v.mesh.volume.toFixed(1),
          thumbSource:v.thumbSource, thumbBytes:v.thumb? v.thumb.length:0,
          printer:v.slice.plates[0].printerModel, nozzle:v.slice.plates[0].nozzle,
          seconds:v.slice.plates[0].seconds, weightG:v.slice.plates[0].weightG,
          filament:v.slice.filaments[0],
          settingsShown:Object.keys(v.settings).length, settingsTotal:Object.keys(v.settingsAll).length,
          layer:v.settings.layer_height, preset:v.settings.filament_settings_id,
          warnings:v.warnings};
}));

// --- plain 3MF, no slicer data: falls back to a rendered thumbnail ---
await p.click('#dr-close'); await p.waitForTimeout(250);
await p.click('#btn-addpart'); await p.waitForTimeout(250);
await p.click('[data-pt="versions"]'); await p.waitForTimeout(200);
await p.setInputFiles('#pt-file','/home/claude/fixtures/plain.3mf');
await p.waitForTimeout(1500);
console.log('\n-- plain 3MF --');
console.log(await p.evaluate(()=>{
  const v=(versions[state.part.id]||[])[0];
  return {thumbSource:v.thumbSource, hasThumb:!!v.thumb, bbox:v.mesh.bbox.map(x=>+x.toFixed(1)), warnings:v.warnings};
}));

console.log('\nerrors:', errs.length? errs.slice(0,4):'none');
await b.close();
