import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {restoreRoom} from '../src/room-snapshot.ts';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function game(map=0,players=1){const e=await Engine.create(binary,map,0,players);return {e,st:new Int32Array(e.wasm.memory.buffer,4096,2128),aux:new DataView(e.wasm.memory.buffer,4120,32)};}
function step(g,b=0,n=1){for(let i=0;i<n;i++)g.e.step(Array.from({length:g.e.players},(_,id)=>id===0?b:0));}
function place(g,x,y,vx,vy){g.st.set([x*Q,y*Q,vx*Q,vy*Q,0,0,6000,600,0,0,0,0,0,0,0,0],16);}
test('shield costs 25%, lasts 90 ticks and requires a fresh press after 300 ticks',async()=>{
 const g=await game();step(g,32);assert.equal(g.st[22],4500);assert.equal(g.aux.getUint8(0),90);assert.equal(g.aux.getUint16(2,true),300);
 step(g,32,89);assert.equal(g.aux.getUint8(0),1);step(g,32);assert.equal(g.aux.getUint8(0),0);
 step(g,32,210);assert.equal(g.aux.getUint16(2,true),0);assert.equal(g.aux.getUint8(0),0);
 step(g);step(g,32);assert.equal(g.aux.getUint8(0),90);assert.equal(g.st[22],3000);
});
test('energy threshold, death and shared thrust/boost consumption',async()=>{
 for(const energy of [0,1499,1500]){const g=await game();g.st[22]=energy;step(g,32);assert.equal(g.aux.getUint8(0),energy===1500?90:0);assert.equal(g.st[22],energy===1500?0:energy);}
 const dead=await game();dead.st[23]=0;dead.st[26]=120;step(dead,32);assert.equal(dead.aux.getUint8(0),0);
 const both=await game();step(both,49);assert.equal(both.st[22],6000-1500-120-2);assert.equal(both.st[29],18);assert.equal(both.aux.getUint8(0),90);
});
test('shield bounces off both wall faces, ceiling, floor and rounded corners without damage',async()=>{
 // Pillar occupies x=1088..1312, y=525..1088; shelf below ends at y=1200.
 for(const [x,y,vx,vy,axis,sign] of [[1058,1000,64,0,18,-1],[1342,1000,-64,0,18,1],[1162,495,0,64,19,-1],[1162,1230,0,-64,19,1],[1066,503,40,40,18,-1]]){
  const g=await game(32768);place(g,x,y,vx,vy);step(g,32);
  assert.equal(g.st[23],600,`${x},${y}`);assert.equal(g.st[27],0);assert.ok(g.st[axis]*sign>0,`${x},${y}: ${g.st[axis]}`);assert.ok(g.aux.getUint8(1)>0);g.e.load(g.e.save());
  step(g,0,3);assert.equal(g.st[23],600,'must separate from surface');
 }
});
test('unshielded or expired wall slam crashes; shield still permits safe pad landing',async()=>{
 for(const active of [false,true]){const g=await game(32768);place(g,1058,1000,64,0);if(active)g.aux.setUint8(0,1);step(g);assert.equal(g.st[23],0);assert.equal(g.st[27],-1);}
 const g=await game(32768);place(g,338,1259,0,.5);g.st[17]--;step(g,32);assert.equal(g.st[24],1);assert.equal(g.st[23],600);assert.equal(g.aux.getUint8(1),0);
});
test('pads recharge energy in about four seconds and hull in ten, with capacity clamps',async()=>{
 const g=await game(32768);g.st[22]=0;g.st[23]=1;step(g,0,231);assert.equal(g.st[22],6000);assert.equal(g.st[23],232);
 step(g,0,368);assert.equal(g.st[23],600);step(g,0,20);assert.equal(g.st[23],600);assert.equal(g.st[22],6000);
 step(g,1);g.st[23]=100;g.st[22]=100;step(g);assert.equal(g.st[23],100);assert.equal(g.st[22],100);
});
test('unshielded bullet hits interrupt repairs and credit fractional-health kills',async()=>{
 const g=await game(32768,2);g.st[28]=0;step(g);g.st[28]=0;
 const pool=new Int32Array(g.e.wasm.memory.buffer,4416,2048);
 pool.set([g.st[16],g.st[17],0,0,10,1,1,0]);g.st[3]=1;step(g);assert.equal(g.st[23],400);assert.equal(g.aux.getUint16(4,true),60);
 step(g,0,59);assert.equal(g.st[23],400);step(g);assert.equal(g.st[23],401);
 g.st[23]=199;pool.set([g.st[16],g.st[17],0,0,10,1,2,0]);g.st[3]=2;step(g);assert.equal(g.st[23],0);assert.equal(g.st[43],1);
});
test('shield snapshots restore timers, impact flash and exact future hashes; reject invalid auxiliary fields',async()=>{
 const g=await game(32768);place(g,1058,1000,64,0);step(g,32);const saved=g.e.save();step(g,0,50);const hash=g.e.hash();g.e.load(saved);step(g,0,50);assert.equal(g.e.hash(),hash);
 for(const [offset,value]of [[24,91],[25,13],[26,301],[28,61],[30,2],[31,1],[32,1]]){const bad=saved.slice();new DataView(bad.buffer).setUint16(offset,value,true);assert.throws(()=>g.e.load(bad));assert.equal(g.e.hash(),hash);}
});
test('room compaction follows each players shield and repair state',async()=>{
 const g=await game(32768,3);g.e.step([0,32,32]);g.aux.setUint16(20,33,true);
 const next=await restoreRoom(binary,0,2,Buffer.from(g.e.save()).toString('base64'),[2,1]);
 assert.deepEqual(next.frame().slice(6,8),g.st.slice(10,12));assert.deepEqual(next.frame().slice(8,10),g.st.slice(8,10));assert.deepEqual([...next.frame().slice(10,14)],[0,0,0,0]);next.load(next.save());
});
function shipAt(g,id,x,y,vx=0,vy=0){g.st.set([x*Q,y*Q,vx*Q,vy*Q,0,0,6000,600,0,0,0,0,0,0,0,0],16+id*16);}
for(const players of [2,3,4])test(`${players} players: either or both shields cushion every ship pair`,async()=>{
 for(let a=0;a<players;a++)for(let b=a+1;b<players;b++)for(const shielded of [[a],[b],[a,b]]){
  const g=await game(0,players);for(let id=0;id<players;id++)shipAt(g,id,1000+id*200,1000);
  shipAt(g,a,-40,0,64);shipAt(g,b,40,0,-64);
  const inputs=Array.from({length:players},(_,id)=>shielded.includes(id)?32:0);const before=g.e.save();g.e.step(inputs);
  assert.equal(g.st[23+a*16],600);assert.equal(g.st[23+b*16],600);assert.equal(g.st[27+a*16],0);assert.equal(g.st[27+b*16],0);
  assert.ok(g.st[18+a*16]<0);assert.ok(g.st[18+b*16]>0);
  assert.ok(Math.abs(g.st[18+a*16])+Math.abs(g.st[18+b*16])<128*Q,'impact loses speed');
  for(const id of [a,b]){assert.equal(g.aux.getUint8(id*8),shielded.includes(id)?90:0);assert.equal(g.aux.getUint16(id*8+2,true),shielded.includes(id)?300:0);assert.equal(g.aux.getUint8(id*8+1),shielded.includes(id)?12:0);}
  const hash=g.e.hash();g.e.load(before);g.e.step(inputs);assert.equal(g.e.hash(),hash);g.e.load(g.e.save());
  for(let t=0;t<10;t++)g.e.step(Array(players).fill(0));assert.equal(g.st[23+a*16],600);assert.equal(g.st[23+b*16],600);
 }
});
test('glancing shield collision preserves tangential motion and does not add kinetic energy',async()=>{
 const g=await game(0,2);shipAt(g,0,-20,0,64,2);shipAt(g,1,20,31,-64,2);
 const energy=()=>[18,19,34,35].reduce((sum,o)=>sum+g.st[o]**2,0);const initial=energy();g.e.step([32,0]);
 assert.equal(g.st[23],600);assert.equal(g.st[39],600);assert.ok(g.st[19]<0);assert.ok(g.st[35]>0);assert.ok(energy()<initial);
 assert.ok(Math.abs(g.st[18]+g.st[34])<10,'equal/opposite impulses preserve horizontal momentum');g.e.load(g.e.save());
});
test('overlapping and coincident shielded ships separate without repeated acceleration',async()=>{
 for(const [x,vx]of [[0,0],[0,10],[1,10],[31,-10]]){
  const g=await game(0,2);shipAt(g,0,0,0,vx);shipAt(g,1,x,0,-vx);g.e.step([32,0]);
  assert.equal(g.st[23],600);assert.equal(g.st[39],600);assert.ok(Math.hypot(g.st[16]-g.st[32],g.st[17]-g.st[33])>=32*Q);
  const speed=Math.abs(g.st[18])+Math.abs(g.st[34]);for(let t=0;t<30;t++)g.e.step([0,0]);
  assert.ok(Math.abs(g.st[18])+Math.abs(g.st[34])<=speed);assert.equal(g.st[23],600);assert.equal(g.st[39],600);g.e.load(g.e.save());
 }
});
test('shield collisions with a parked ship preserve the pad and both hulls',async()=>{
 for(const buttons of [[32,0],[0,32],[32,32]]){
  const g=await game(32768,2);shipAt(g,0,338,1223,0,12);shipAt(g,1,338,1259,0,0);g.st[33]--;g.st[40]=1;
  g.e.step(buttons);assert.equal(g.st[23],600);assert.equal(g.st[39],600);assert.ok(g.st[19]<0);assert.equal(g.st[40],1);assert.equal(g.st[33],1259*Q-1);g.e.load(g.e.save());
 }
});
test('shielded pad side impacts slide the parked ship without invalid grounding',async()=>{
 const g=await game(32768,2);shipAt(g,0,298,1259,20,0);g.st[17]--;g.st[24]=1;shipAt(g,1,338,1259,0,0);g.st[33]--;g.st[40]=1;
 // A fast incoming ship just above pad level, so the first collision is a hull.
 g.st[24]=0;g.st[17]-=Q;g.e.step([32,0]);
 assert.equal(g.st[23],600);assert.equal(g.st[39],600);g.e.load(g.e.save());
});
test('shield expiry, near misses and dead ships retain the normal collision rules',async()=>{
 const expired=await game(0,2);shipAt(expired,0,-40,0,64);shipAt(expired,1,40,0,-64);expired.aux.setUint8(0,1);expired.e.step([0,0]);assert.equal(expired.st[23],0);assert.equal(expired.st[39],0);
 for(const dead of [false,true]){const g=await game(0,2);shipAt(g,0,-40,0,64);shipAt(g,1,40,dead?0:33,-64);if(dead){g.st[39]=0;g.st[42]=120;}g.e.step([32,0]);assert.ok(g.st[18]>0);assert.equal(g.aux.getUint8(1),0);assert.equal(g.st[23],600);}
});
test('simultaneous shield contacts remain deterministic and do not create energy',async()=>{
 const g=await game(0,3);shipAt(g,0,-32,0,12);shipAt(g,1,0,0,0);shipAt(g,2,32,0,-12);
 const snapshot=g.e.save();g.e.step([0,32,0]);const energy=[18,34,50].reduce((sum,o)=>sum+g.st[o]**2,0);assert.ok(energy<=2*(12*Q)**2);
 for(const o of [23,39,55])assert.equal(g.st[o],600);g.e.load(g.e.save());for(let i=0;i<60;i++)g.e.step([0,0,0]);const hash=g.e.hash();
 g.e.load(snapshot);g.e.step([0,32,0]);for(let i=0;i<60;i++)g.e.step([0,0,0]);assert.equal(g.e.hash(),hash);
});
test('a bullet can damage the unshielded ship during a cushioned ship collision',async()=>{
 for(const hull of [200,600]){
  const g=await game(0,2);shipAt(g,0,-40,0,64);shipAt(g,1,40,0,-64);g.st[23]=hull;
  new Int32Array(g.e.wasm.memory.buffer,4416,8).set([-40*Q,0,0,0,10,1,1,0]);g.st[3]=1;
  g.e.step([0,32]);assert.equal(g.st[23],hull-200);assert.equal(g.st[39],600);assert.equal(g.st[27],0);assert.equal(g.st[43],hull===200?1:0);g.e.load(g.e.save());
 }
});
test('active shields absorb incoming shots at the bubble and preserve hull, timers and energy',async()=>{
 for(let target=0;target<4;target++)for(const ticks of [2,3,90]){
  const g=await game(0,4);for(let id=0;id<4;id++)shipAt(g,id,1000+id*300,1000);
  shipAt(g,target,0,0);g.aux.setUint8(target*8,ticks);g.aux.setUint16(target*8+2,100,true);
  // This stationary shot is outside the hull but inside the visible shield.
  const pool=new Int32Array(g.e.wasm.memory.buffer,4416,8);pool.set([22*Q,0,0,0,10,(target+1)%4,1,0]);g.st[3]=1;
  const snapshot=g.e.save();g.e.step([0,0,0,0]);assert.equal(g.st[23+target*16],600);assert.ok(pool.every(v=>v===0));
  assert.equal(g.aux.getUint8(target*8+1),12);assert.equal(g.aux.getUint8(target*8),ticks-1);assert.equal(g.aux.getUint16(target*8+2,true),99);assert.equal(g.st[22+target*16],6000);
  assert.equal(g.aux.getUint16(target*8+4,true),0);for(let id=0;id<4;id++)assert.equal(g.st[27+id*16],0);
  const hash=g.e.hash();g.e.load(snapshot);g.e.step([0,0,0,0]);assert.equal(g.e.hash(),hash);g.e.load(g.e.save());
 }
});
test('shields absorb volleys and stop shots reaching ships behind them',async()=>{
 const g=await game(0,3);shipAt(g,0,0,0);shipAt(g,1,40,0);shipAt(g,2,-300,0);
 const pool=new Int32Array(g.e.wasm.memory.buffer,4416,2048);for(let i=0;i<5;i++)pool.set([-30*Q,0,76*Q,0,10,2,i+1,0],i*8);g.st[3]=5;
 g.e.step([32,0,0]);assert.equal(g.st[23],600);assert.equal(g.st[39],600);assert.ok(pool.every(v=>v===0));assert.equal(g.aux.getUint8(1),12);
});
test('shield blocks shots during spawn protection without interrupting pad repair',async()=>{
 const g=await game(32768,2);g.st[23]=300;
 const pool=new Int32Array(g.e.wasm.memory.buffer,4416,8);pool.set([g.st[16],g.st[17]-22*Q,0,0,10,1,1,0]);g.st[3]=1;
 g.e.step([32,0]);assert.equal(g.st[23],301);assert.ok(pool.every(v=>v===0));assert.equal(g.aux.getUint16(4,true),0);assert.equal(g.aux.getUint8(1),12);
});
test('shots damage hull immediately after the shield expires',async()=>{
 const g=await game(0,2);shipAt(g,0,0,0);shipAt(g,1,300,0);g.aux.setUint8(0,1);
 new Int32Array(g.e.wasm.memory.buffer,4416,8).set([0,0,0,0,10,1,1,0]);g.st[3]=1;
 g.e.step([0,0]);assert.equal(g.st[23],400);assert.equal(g.aux.getUint8(1),0);
});
