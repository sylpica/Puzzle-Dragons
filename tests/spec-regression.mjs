// Run with: node tests/spec-regression.mjs
// Isolated source-function regression tests, not a substitute for browser/device testing.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const between=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b);if(i<0||j<i)throw Error("Missing source: "+a);return source.slice(i,j)};
const types=Object.fromEntries(["fire","water","wood","light","dark","heal","poison","dpoison","jammer","bomb"].map(t=>[t,{name:t}]));
const sanitizer=new Function("TYPES","ROUL_OK",`let uidSeq=1;
 ${between("const hasOnly=","function refreshSaveList()")}
 return sanitizeData;`)(types,new Set(["fire","water","wood","light","dark","heal","poison","jammer"]));
const fresh=(cols=6,rows=5)=>{
 const basic=["fire","water","wood","light","dark","heal"];
 return {cols,rows,
  board:Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>({
    uid:r*cols+c+1,t:basic[(r*2+c)%6],plus:false,weak:false,lock:false,thorn:false,blind:false,sblind:0,unerase:false
  }))),
  pos:Array.from({length:rows},()=>Array.from({length:cols},()=>({cloud:0,tape:false,roul:null})))
 };
};
const tests=[];
function test(name,fn){tests.push([name,fn])}
test("strict persistence and phase roundtrip",()=>{
 let x=fresh();x.pos[0][0].roul={colors:["water","heal"],idx:1,interval:500,next:0};
 let a=sanitizer(x),b=sanitizer(JSON.parse(JSON.stringify(a)));
 assert.equal(a.pos[0][0].roul.idx,1);
 assert.deepEqual(a,b);
 x=fresh();x.board[0][1].uid=x.board[0][0].uid;assert.equal(sanitizer(x),null);
 x=fresh();x.board[0][0].t="__proto__";assert.equal(sanitizer(x),null);
 x=fresh();x.board[0][0].unexpected=true;assert.equal(sanitizer(x),null);
 x=fresh();x.pos[0][0].roul={colors:["water","heal"],idx:8,interval:500,next:0};assert.equal(sanitizer(x),null);
});
const eff=between("function effType(r,c){","/* ---------- rendering:");
test("roulette stops on held/locked only",()=>{
 const x=fresh(),fn=new Function("board","pos","held",eff+";return effType;");
 x.board[0][0].t="poison";x.pos[0][0].roul={colors:["fire","water"],idx:1};
 assert.equal(fn(x.board,x.pos,null)(0,0),"water");
 assert.equal(fn(x.board,x.pos,{r:0,c:0})(0,0),"poison");
 x.board[0][0].lock=true;assert.equal(fn(x.board,x.pos,null)(0,0),"poison");
});
const matches=between("function findMatches(){","function gravityAndRefill(){");
const solve=between("async function resolveBoard(){","/* ---------- play input ---------- */");
const makeRuntime=new Function("fixture",`
 let board=fixture.board,cols=fixture.cols,rows=fixture.rows,pos=fixture.pos,held=null,turn=0,maxCombo=0,turnDmg=0,dmgEntries=[],thornsThisMove=0,resolving=false,refills=0;
 const TYPES=Object.fromEntries(["fire","water","wood","light","dark","heal","poison","dpoison","jammer","bomb"].map(x=>[x,{name:x}]));
 const basic=["fire","water","wood","light","dark","heal"];let id=1000;
 const elements={};const $=id=>(elements[id] ||= {textContent:"",innerHTML:""});
 function fmtPct(v){return (Math.round(v*10)/10).toString()+"%"}
 function logDmg(x){elements.dmglog={textContent:"",innerHTML:x}}
 function render(){} function showComboPop(n){} function hideComboPop(){}
 const wait=()=>Promise.resolve(),flashCells=()=>Promise.resolve();
 function gravityAndRefill(){
  refills++;
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)
   if(!board[r][c])board[r][c]={uid:id++,t:basic[(r*2+c)%6],unerase:false,lock:false,sblind:0}
 }
 ${eff}
 ${matches}
 ${solve}
 return {run:async()=>{const initial=findMatches().groups.map(g=>({type:g.type,n:g.cells.length}));await resolveBoard();
  return {initial,turn,refills,combos:elements.stCombo?.textContent,damage:elements.lrDmg?.textContent,details:elements.lrDetail?.innerHTML}}};
`);
test("simultaneous combos refill only after their batch",async()=>{
 const x=fresh();
 for(let r=0;r<3;r++){x.board[r][0].t="fire";x.board[r][3].t="water"}
 const a=await makeRuntime(x).run();
 assert.equal(a.initial.length,2);assert.equal(a.refills,1);assert.equal(a.combos,2);
});
test("matched bombs survive explosion from an isolated bomb",async()=>{
 const x=fresh();
 for(let c=0;c<3;c++)x.board[0][c].t="bomb";
 x.board[0][5].t="bomb";
 const a=await makeRuntime(x).run();
 assert.equal(a.initial.length,1);assert.equal(a.damage,"20%");
 assert.match(a.details,/bomb 3個/);
});
let failed=0;
for(const [name,fn] of tests){
 try{await fn();console.log("PASS",name)}
 catch(e){failed++;console.error("FAIL",name,e)}
}
console.log(`${tests.length-failed}/${tests.length} PASS (isolated source-function tests)`);
if(failed)process.exitCode=1;
