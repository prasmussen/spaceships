import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function create(){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;assert.equal(s.init(1024,32769,0,2),1);return {s,st:new Int32Array(s.memory.buffer,4096,2128)};}
function step(s,buttons=0,n=1){new Uint8Array(s.memory.buffer,2048,2).set([buttons,0]);for(let i=0;i<n;i++)s.step(2048,1);}
test('arena starts on two working pads, supports launch, landing and refueling',async()=>{
  const {s,st}=await create();assert.equal(st[2],2);
  for(const o of [16,32]){assert.equal(st[o+8],1);assert.equal(st[o+1],1700*Q-16*Q-1);}
  step(s,1);assert.equal(st[24],0);
  st[16]=450*Q;st[17]=1683.5*Q;st[18]=0;st[19]=.5*Q;st[20]=0;st[21]=0;st[22]=1000;
  step(s,0,3);assert.equal(st[24],1);assert.ok(st[22]>1000);
});
test('ships and debris cross the arena center but collide with its perimeter',async()=>{
  const {s,st}=await create();st[16]=1400*Q;st[17]=1000*Q;st[18]=64*Q;st[24]=0;
  st.set([1400*Q,1100*Q,64*Q,0,186,0,1,0x10000000],80);st[3]=1;
  step(s,0,4);assert.equal(st[23],3);assert.ok(st[16]>1600*Q);assert.ok(st[80]>1600*Q);assert.equal(st[82],64*Q);
  st[16]=100*Q;st[17]=1000*Q;st[18]=-64*Q;step(s);assert.equal(st[23],0);
});
test('arena snapshots retain map identity and reproduce future movement',async()=>{
  const {s,st}=await create();step(s,1,10);s.save_state(65536);step(s,1,20);const hash=s.state_hash();
  assert.equal(s.load_state(65536,8512),1);step(s,1,20);assert.equal(s.state_hash(),hash);assert.equal(st[2],2);
});

test('expanded map has four supported pads and substantially more open space',async()=>{
  const cave=JSON.parse(await readFile('sim/cave.json','utf8'));
  assert.equal(cave.width*cave.height,3200*2000*4);
  assert.equal(cave.pads.length,4);
  // The arena retains only perimeter walls and the four small pad platforms.
  const solidArea=cave.solids.slice(0,8).reduce((sum,[x0,y0,x1,y1])=>sum+(x1-x0)*(y1-y0),0);
  assert.ok(solidArea/(cave.width*cave.height)<.11);
  for(const pad of cave.pads)assert.ok(cave.solids.slice(4,8).some(([x0,y0,x1])=>y0===pad.y&&x0<=pad.x-pad.halfWidth&&x1>=pad.x+pad.halfWidth));
});
