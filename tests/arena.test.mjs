import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function create(){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;assert.equal(s.init(1024,32769,0,2),1);return {s,st:new Int32Array(s.memory.buffer,4096,2128)};}
function step(s,buttons=0,n=1){new Uint8Array(s.memory.buffer,2048,2).set([buttons,0]);for(let i=0;i<n;i++)s.step(2048,1);}
test('arena starts on two working pads, supports launch, landing and refueling',async()=>{
  const {s,st}=await create();assert.equal(st[2],2);
  for(const o of [16,32]){assert.equal(st[o+8],1);assert.equal(st[o+1],1275*Q-16*Q-1);}
  step(s,1);assert.equal(st[24],0);
  st[16]=338*Q;st[17]=1258.5*Q;st[18]=0;st[19]=.5*Q;st[20]=0;st[21]=0;st[22]=1000;
  step(s,0,3);assert.equal(st[24],1);assert.ok(st[22]>1000);
});
test('ships and debris collide with arena landmarks and the perimeter',async()=>{
  const {s,st}=await create();st[16]=1038*Q;st[17]=750*Q;st[18]=64*Q;st[24]=0;
  st.set([1038*Q,825*Q,64*Q,0,186,0,1,0x10000000],80);st[3]=1;
  step(s,0,4);assert.equal(st[23],0);assert.ok(st[16]<1088*Q);assert.ok(st[80]<1088*Q);assert.ok(st[82]<0);
  st[16]=100*Q;st[17]=750*Q;st[18]=-64*Q;step(s);assert.equal(st[23],0);
});
test('arena snapshots retain map identity and reproduce future movement',async()=>{
  const {s,st}=await create();step(s,1,10);s.save_state(65536);step(s,1,20);const hash=s.state_hash();
  assert.equal(s.load_state(65536,8512),1);step(s,1,20);assert.equal(s.state_hash(),hash);assert.equal(st[2],2);
});

test('arena landmarks cover the map while preserving open routes and supported pads',async()=>{
  const cave=JSON.parse(await readFile('sim/cave.json','utf8'));
  assert.equal(cave.width*cave.height,4800*3000);
  assert.equal(cave.pads.length,4);
  const solidArea=cave.solids.reduce((sum,[x0,y0,x1,y1])=>sum+(x1-x0)*(y1-y0),0);
  assert.ok(solidArea/(cave.width*cave.height)<.25);
  for(let y=0;y<4;y++)for(let x=0;x<4;x++)assert.ok(cave.solids.slice(8).some(([x0,y0,x1,y1])=>x0<(x+1)*1200&&x1>x*1200&&y0<(y+1)*750&&y1>y*750),`landmark in sector ${x},${y}`);
  for(const pad of cave.pads)assert.ok(cave.solids.slice(4,8).some(([x0,y0,x1])=>y0===pad.y&&x0<=pad.x-pad.halfWidth&&x1>=pad.x+pad.halfWidth));
});
