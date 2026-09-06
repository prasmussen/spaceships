import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm');
const Q=65536;
async function create(map=0){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;s.init(1024,map,0,2);return {s,st:new Int32Array(s.memory.buffer,4096,2128),pool:new Int32Array(s.memory.buffer,4416,2048)};}
function step(s,a=0,b=0,n=1){new Uint8Array(s.memory.buffer,2048,2).set([a,b]);for(let i=0;i<n;i++)s.step(2048,1);}
function arena(st){for(let p=0;p<2;p++){const o=16+p*16;st[o]=p?60*Q:-60*Q;st[o+1]=0;st[o+2]=0;st[o+3]=0;st[o+4]=p?3072:1024;st[o+5]=0;st[o+7]=600;st[o+8]=0;st[o+9]=0;st[o+10]=0;st[o+12]=0;}}
test('head-on contact explodes both ships once and respawns both after two seconds',async()=>{
  const {s,st}=await create();arena(st);st[16]=-40*Q;st[32]=40*Q;st[18]=64*Q;st[34]=-64*Q;
  s.save_state(65536);step(s);s.write_frame(81920);
  const first=new Int32Array(s.memory.buffer.slice(81920,81920+2129*4+64));
  assert.equal(st[23],0);assert.equal(st[39],0);
  assert.equal(st[26],120);assert.equal(st[42],120);
  assert.equal(st[27],-1);assert.equal(st[43],-1);
  assert.ok(Math.abs((st[32]-st[16])/Q-32)<.002);
  assert.equal(first[2128],2);assert.equal(first[2132],5);assert.equal(first[2140],5);
  assert.equal(st[18],0);assert.equal(st[34],0);
  const hash=s.state_hash();assert.equal(s.load_state(65536,8512),1);step(s);s.write_frame(81920);
  assert.equal(s.state_hash(),hash);assert.deepEqual(new Int32Array(s.memory.buffer.slice(81920,81920+first.byteLength)),first);
  step(s,0,0,119);assert.equal(st[23],0);assert.equal(st[39],0);
  step(s);assert.equal(st[23],600);assert.equal(st[39],600);
});
test('overlapping protected hulls still both explode',async()=>{
  const {s,st}=await create();arena(st);st[16]=0;st[32]=31*Q;st[28]=90;st[44]=90;
  step(s);assert.equal(st[23],0);assert.equal(st[39],0);
});
test('swept hull contact catches a glancing crossing when substep endpoints miss',async()=>{
  const {s,st}=await create();arena(st);st[16]=-20*Q;st[32]=20*Q;st[33]=31*Q;st[18]=64*Q;st[34]=-64*Q;
  step(s);assert.equal(st[23],0);assert.equal(st[39],0);
});
test('fast near misses and dead hulls do not cause ship crashes',async()=>{
  for(const dead of [false,true]){
    const {s,st}=await create();arena(st);st[16]=-40*Q;st[32]=40*Q;st[18]=64*Q;st[34]=-64*Q;
    if(dead){st[39]=0;st[42]=120;}else st[33]=33*Q;
    step(s);assert.equal(st[23],600);assert.equal(st[27],0);assert.equal(st[39],dead?0:600);
  }
});
test('muzzle velocity inherits both ship velocity components',async()=>{const {s,st,pool}=await create();arena(st);st[18]=2*Q;st[19]=3*Q;step(s,8);assert.equal(pool[2],14*Q);assert.equal(pool[3],3*Q);assert.equal(st[25],8);assert.equal(pool[4],119);});
test('held fire respects cooldown and finite projectile lifetime',async()=>{const {s,st,pool}=await create();st[20]=0;step(s,8);const id=st[3];step(s,8,0,7);assert.equal(st[3],id);step(s,8);assert.equal(st[3],id+1);step(s,0,0,120);assert.ok([...pool].every(v=>v===0));});
test('three hits kill, grant one point, and preserve simultaneous trades',async()=>{const {s,st}=await create();arena(st);step(s,8,8,24);assert.equal(st[23],0);assert.equal(st[39],0);assert.equal(st[27],1);assert.equal(st[43],1);assert.ok(st[26]>0 && st[42]>0);});
test('a complete first-to-five match freezes at the winning tick',async()=>{const {s,st}=await create();for(let kill=0;kill<5;kill++){arena(st);step(s,8,0,24);assert.equal(st[43],0);assert.equal(st[27],kill+1);}assert.equal(st[1],0);const hash=s.state_hash();step(s,15,15,60);assert.equal(s.state_hash(),hash);s.save_state(65536);assert.equal(s.load_state(65536,8512),1);});
test('simultaneous fifth kills continue until one player leads',async()=>{const {s,st}=await create();arena(st);st[27]=4;st[43]=4;st[0]=100;step(s,8,8,24);assert.equal(st[27],5);assert.equal(st[43],5);assert.equal(st[1],-1);arena(st);step(s,8,0,24);assert.equal(st[27],6);assert.equal(st[1],0);});
test('spawn protection expires, and ends immediately upon firing or leaving pad',async()=>{const {s,st}=await create(32768);assert.equal(st[28],90);step(s,0,0,89);assert.equal(st[28],1);step(s);assert.equal(st[28],0);s.init(1024,32768,0,2);step(s,8);assert.equal(st[28],0);s.init(1024,32768,0,2);step(s,1);assert.equal(st[28],0);});
test('protected target takes no projectile damage',async()=>{const {s,st,pool}=await create(32768);pool.set([338*Q,1259*Q,0,0,10,1,1,0]);st[3]=1;step(s);assert.equal(st[23],600);assert.equal(pool[4],9);});
test('pool allocation chooses the lowest free slot and snapshots include reuse state',async()=>{const {s,st,pool}=await create();arena(st);for(let i=0;i<256;i++)pool.set([0,-500*Q,0,0,100,0,i+1,0],i*8);st[3]=256;step(s,8);assert.equal(st[3],256);pool.fill(0,7*8,8*8);step(s,8);assert.equal(pool[7*8+6],257);s.save_state(65536);step(s,8,8,30);const hash=s.state_hash();assert.equal(s.load_state(65536,8512),1);step(s,8,8,30);assert.equal(s.state_hash(),hash);});
test('malformed projectile snapshots are rejected without partial restoration',async()=>{const {s}=await create();step(s,8);for(const [field,value]of [[0,-2147483648],[2,4980737],[4,121],[5,2],[6,0],[7,1]]){s.save_state(65536);new DataView(s.memory.buffer).setInt32(65536+320+field*4,value,true);const hash=s.state_hash();assert.equal(s.load_state(65536,8512),0);assert.equal(s.state_hash(),hash);}});
test('moving-target sweep detects a hit even when both endpoints miss',async()=>{const {s,st,pool}=await create();st[32]=0;st[33]=0;st[34]=64*Q;pool.set([50*Q,0,-76*Q,0,10,0,1,0]);st[3]=1;step(s);assert.equal(st[39],400);assert.equal(pool[4],0);});
test('terrain absorbs projectiles before a ship beyond the pillar',async()=>{const {s,st,pool}=await create(32768);for(let p=0;p<2;p++){const o=16+p*16;st[o]=(p?1362:1038)*Q;st[o+1]=750*Q;st[o+4]=p?3072:1024;st[o+8]=0;st[o+12]=0;}step(s,8);step(s,0,0,9);assert.equal(st[39],600);assert.equal(st[27],0);assert.ok([...pool].filter((_,i)=>i%8===4).every(v=>v===0));});
test('snapshot validation rejects duplicate projectile IDs and unsafe remaining travel',async()=>{const {s}=await create();step(s,8,8);s.save_state(65536);let view=new DataView(s.memory.buffer);view.setInt32(65536+320+32+24,1,true);assert.equal(s.load_state(65536,8512),0);s.save_state(65536);view.setInt32(65536+320,1670000000,true);view.setInt32(65536+320+8,4980736,true);assert.equal(s.load_state(65536,8512),0);});
for(const target of [0,1])test(`same-tick crash and lethal projectile resolve consistently for player ${target}`,async()=>{const {s,st,pool}=await create(32768);const o=16+target*16,other=16+(1-target)*16;st[o]=1058*Q;st[o+1]=750*Q;st[o+2]=64*Q;st[o+7]=200;st[o+8]=0;st[o+12]=0;st[other]=1362*Q;st[other+1]=750*Q;st[other+8]=0;st[other+12]=0;pool.set([1038*Q,750*Q,76*Q,0,10,1-target,1,0]);st[3]=1;step(s);assert.equal(st[o+7],0);assert.equal(st[o+11],-1);assert.equal(st[other+11],0);});
