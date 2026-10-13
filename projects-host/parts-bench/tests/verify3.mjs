const M={PLA:{A:.325,hf:1.00,eS:.39,eH:.82},PETG:{A:.425,hf:1.29,eS:.23,eH:.48},ASA:{A:.375,hf:1.41,eS:.18,eH:.38}};
const V={revo:{standard:40,highflow:49.2},h2:{standard:76.9,highflow:107.7},x1c:{standard:64.6}};
const q=(vb,d,cls,k,cap)=>{const m=M[k],e=cls==="highflow"?m.eH:m.eS,h=cls==="highflow"?m.hf:1;
  return Math.min(m.A*h*vb*Math.pow(d/0.4,e),cap);};
const rows=[
 ["Revo std PLA 0.4",q(V.revo.standard,.4,"standard","PLA",40),13],
 ["Revo std PLA 0.6",q(V.revo.standard,.6,"standard","PLA",40),14],
 ["Revo std PLA 0.8",q(V.revo.standard,.8,"standard","PLA",40),17],
 ["Revo HF  PLA 0.4",q(V.revo.highflow,.4,"highflow","PLA",40),16],
 ["Revo HF  PLA 0.6",q(V.revo.highflow,.6,"highflow","PLA",40),22],
 ["Revo HF  PLA 0.8",q(V.revo.highflow,.8,"highflow","PLA",40),28],
 ["Revo std PETG 0.4",q(V.revo.standard,.4,"standard","PETG",40),17],
 ["Revo std PETG 0.6",q(V.revo.standard,.6,"standard","PETG",40),18],
 ["Revo std PETG 0.8",q(V.revo.standard,.8,"standard","PETG",40),20],
 ["Revo HF  PETG 0.4",q(V.revo.highflow,.4,"highflow","PETG",40),27],
 ["Revo HF  PETG 0.6",q(V.revo.highflow,.6,"highflow","PETG",40),31],
 ["Revo HF  PETG 0.8",q(V.revo.highflow,.8,"highflow","PETG",40),38],
 ["Revo std ASA 0.4",q(V.revo.standard,.4,"standard","ASA",40),15],
 ["Revo std ASA 0.6",q(V.revo.standard,.6,"standard","ASA",40),16],
 ["Revo std ASA 0.8",q(V.revo.standard,.8,"standard","ASA",40),17],
 ["Revo HF  ASA 0.4",q(V.revo.highflow,.4,"highflow","ASA",40),26],
 ["Revo HF  ASA 0.6",q(V.revo.highflow,.6,"highflow","ASA",40),29],
 ["Revo HF  ASA 0.8",q(V.revo.highflow,.8,"highflow","ASA",40),34],
 ["X1C  PLA 0.4",q(V.x1c.standard,.4,"standard","PLA",32),21],
 ["H2S  PLA 0.4",q(V.h2.standard,.4,"standard","PLA",40),25],
 ["H2 HF PLA 0.4",q(V.h2.highflow,.4,"highflow","PLA",40),35],
 ["H2 HF PLA 0.6 cap",q(V.h2.highflow,.6,"highflow","PLA",40),40],
];
let w=0,n10=0;
for(const [n,m,o] of rows){const e=(m-o)/o*100;w=Math.max(w,Math.abs(e));if(Math.abs(e)<=10)n10++;
 console.log(n.padEnd(22),"model",m.toFixed(1).padStart(5)," pub",String(o).padStart(3)," err",(e>=0?"+":"")+e.toFixed(1)+"%");}
console.log(`\nworst ${w.toFixed(1)}%   within 10%: ${n10}/${rows.length}`);
console.log("\nX1C PLA 0.6:",q(V.x1c.standard,.6,"standard","PLA",32).toFixed(1),"  X1C PLA 0.8:",q(V.x1c.standard,.8,"standard","PLA",32).toFixed(1));
console.log("H2S std ABS-family 0.4:",q(V.h2.standard,.4,"standard","ASA",40).toFixed(1),"  H2 HF ASA 0.6:",q(V.h2.highflow,.6,"highflow","ASA",65).toFixed(1));
