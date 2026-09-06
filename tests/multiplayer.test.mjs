import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine,STATE_BYTES} from '../src/engine.ts';
const binary=await readFile('public/simulation.wasm'),cave=JSON.parse(await readFile('sim/cave.json','utf8')),Q=65536;
async function game(players=4,map=0,seed=0){const engine=await Engine.create(binary,map,seed,players);return {engine,st:new Int32Array(engine.wasm.memory.buffer,4096,STATE_BYTES/4),pool:new Int32Array(engine.wasm.memory.buffer,4416,2048)};}
function ship(st,id,x,y){const o=16+16*id;st.set([x*Q,y*Q,0,0,0,0,6000,600,0,0,0,0,0,0,0,0],o);}
for(const players of [2,3,4])test(`${players} active slots start separately, move, shoot and restore deterministically`,async()=>{
  for(let seed=0;seed<4;seed++){
    const {engine,st}=await game(players,32769,seed);
    assert.equal(st[5],players);
    const positions=new Set();for(let id=0;id<players;id++)positions.add(`${st[16+id*16]},${st[17+id*16]}`);
    assert.equal(positions.size,players);assert.ok(st.slice(16+players*16,80).every(v=>v===0));
    const initial=engine.save();engine.step(Array(players).fill(25));
    for(let id=0;id<players;id++){const o=16+id*16;assert.equal(st[o+8],0);assert.equal(st[o+13],18);assert.ok(st[o+6]<6000);assert.equal(st[o+9],8);}
    const hash=engine.hash();engine.load(initial);engine.step(Array(players).fill(25));assert.equal(engine.hash(),hash);
  }
});
test('all four players may land on every shared pad',async()=>{
  for(let id=0;id<4;id++)for(const pad of cave.pads){const {engine,st}=await game(4,32769);
    for(let other=0;other<4;other++)ship(st,other,3300+other*200,1000);
    ship(st,id,pad.x,pad.y-16);const o=16+id*16;st[o+1]--;st[o+3]=30000;engine.step([0,0,0,0]);
    assert.equal(st[o+8],1);assert.equal(st[o+7],600);engine.load(engine.save());
  }
});
test('respawn maximizes minimum distance across all three living opponents',async()=>{
  for(let victim=0;victim<4;victim++){
    const {engine,st}=await game(4,32769);st[0]=100;
    const others=[0,1,2,3].filter(id=>id!==victim);
    others.forEach((id,i)=>ship(st,id,...[[675,975],[3975,2550],[3375,900]][i]));
    const o=16+victim*16;st[o+7]=0;st[o+8]=0;st[o+10]=1;
    const distance=pad=>Math.min(...others.map(id=>(pad.x-st[16+id*16]/Q)**2+(pad.y-16-1/Q-st[17+id*16]/Q)**2));
    const best=[...cave.pads].sort((a,b)=>distance(b)-distance(a))[0];
    engine.step([0,0,0,0]);assert.equal(st[o],best.x*Q);assert.equal(st[o+1],(best.y-16)*Q-1);assert.equal(st[o+7],600);
    engine.load(engine.save());
  }
});
test('projectiles hit the nearest opponent and credit the lethal shooter in slots 2 and 3',async()=>{
  for(const owner of [2,3]){const {engine,st,pool}=await game();
    for(let id=0;id<4;id++)ship(st,id,1000+id*500,1000);
    ship(st,0,100,0);ship(st,1,50,0);st[39]=200;
    pool.set([20*Q,0,76*Q,0,10,owner,1,0]);st[3]=1;
    engine.step([0,0,0,0]);assert.equal(st[39],0);assert.equal(st[23],600);assert.equal(st[27],0);assert.equal(st[16+owner*16+11],1);
    engine.load(engine.save());
  }
});
test('every hull pair collides, including slots 2 and 3',async()=>{
  for(let a=0;a<4;a++)for(let b=a+1;b<4;b++){
    const {engine,st}=await game();for(let id=0;id<4;id++)ship(st,id,1000+id*200,1000);
    ship(st,a,-40,0);ship(st,b,40,0);st[18+a*16]=64*Q;st[18+b*16]=-64*Q;
    engine.step([0,0,0,0]);for(let id=0;id<4;id++){assert.equal(st[23+id*16],id===a||id===b?0:600);assert.equal(st[27+id*16],id===a||id===b?-1:0);}
  }
});
test('four-way simultaneous kills preserve trades and top-score ties, then a unique leader wins',async()=>{
  const {engine,st,pool}=await game();st[0]=100;
  for(let id=0;id<4;id++){ship(st,id,id*300,0);st[23+id*16]=200;st[27+id*16]=4;pool.set([id*300*Q,0,0,0,10,(id+1)%4,id+1,0],id*8);}st[3]=4;
  engine.step([0,0,0,0]);for(let id=0;id<4;id++){assert.equal(st[23+id*16],0);assert.equal(st[27+id*16],5);}assert.equal(st[1],-1);engine.load(engine.save());
  ship(st,0,0,0);st[23]=200;st[27]=5;pool.set([0,0,0,0,10,3,st[3]+1,0]);st[3]++;
  engine.step([0,0,0,0]);assert.equal(st[75],6);assert.equal(st[1],3);engine.load(engine.save());const hash=engine.hash();engine.step([31,31,31,31]);assert.equal(engine.hash(),hash);
});
test('multiple same-tick attackers give one kill to the shot that reaches lethal damage',async()=>{
  const {engine,st,pool}=await game();for(let id=0;id<4;id++)ship(st,id,id*300,0);
  for(let i=0;i<4;i++)pool.set([0,0,0,0,10,[1,2,3,1][i],i+1,0],i*8);st[3]=4;
  engine.step([0,0,0,0]);assert.equal(st[23],0);assert.equal(st[43],0);assert.equal(st[59],0);assert.equal(st[75],1);engine.load(engine.save());
});
test('higher-slot exhaust and debris affect opponents without hull damage',async()=>{
  const {engine,st,pool}=await game();for(let id=0;id<4;id++)ship(st,id,1000+id*300,1000);
  ship(st,2,0,0);ship(st,3,0,50);engine.step([0,0,1,0]);assert.ok(st[67]>3600);assert.equal(st[71],600);
  ship(st,2,0,0);ship(st,3,50,0);st[66]=-Q;pool.set([25*Q,0,40*Q,0,186,2,1,0x10000000]);st[3]=1;
  engine.step([0,0,0,0]);assert.equal(st[71],600);assert.ok(pool[2]<0,'fragment bounces from slot 3');
});
test('player count, unused slots, owners and input-vector length are validated',async()=>{
  const {engine,st}=await game(3);const hash=engine.hash();
  for(const count of [0,5,-1])assert.equal(engine.wasm.init(1024,0,0,count),0);
  assert.equal(engine.hash(),hash);assert.throws(()=>engine.step([0,0]));assert.throws(()=>engine.step([0,0,64]));
  for(const offset of [20,64+3*64]){const snapshot=engine.save();new DataView(snapshot.buffer).setInt32(offset,4,true);assert.throws(()=>engine.load(snapshot));assert.equal(engine.hash(),hash);}
  engine.step([8,8,8]);const snapshot=engine.save();new DataView(snapshot.buffer).setInt32(320+20,3,true);assert.throws(()=>engine.load(snapshot));
  assert.ok(st.slice(64,80).every(v=>v===0));
});
test('batch input stride follows the active player count',async()=>{
  for(const players of [3,4]){const a=await game(players),b=await game(players);const input=new Uint8Array(b.engine.wasm.memory.buffer,2048,120*players);
    for(let tick=0;tick<120;tick++){const buttons=Array.from({length:players},(_,id)=>(tick+id*7)%32);input.set(buttons,tick*players);a.engine.step(buttons);}
    assert.equal(b.engine.wasm.step(2048,120),1);assert.equal(b.engine.hash(),a.engine.hash());b.engine.load(b.engine.save());
  }
});
test('ABI metadata describes four-slot state and snapshot scores cannot lose twice in one tick',async()=>{
  const {engine,st}=await game();const abi=new DataView(engine.wasm.memory.buffer,0,32);
  assert.equal(abi.getInt32(4,true),2);assert.equal(abi.getInt32(12,true),STATE_BYTES);assert.equal(abi.getInt32(28,true),4);
  st[0]=100;const snapshot=engine.save();new DataView(snapshot.buffer).setInt32(108,-101,true);
  assert.throws(()=>engine.load(snapshot));await assert.rejects(()=>Engine.create(binary,0,0,2.5));
});
