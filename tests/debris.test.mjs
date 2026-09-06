import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const binary=await readFile('public/simulation.wasm'),Q=65536;
async function create(map=0){const {instance}=await WebAssembly.instantiate(binary);const s=instance.exports;s.init(1024,map,0,2);return {s,st:new Int32Array(s.memory.buffer,4096,2128),pool:new Int32Array(s.memory.buffer,4416,2048)};}
function step(s,n=1){new Uint8Array(s.memory.buffer,2048,2).fill(0);for(let i=0;i<n;i++)s.step(2048,1);}
function chip(pool,{x=0,y=0,vx=0,vy=0,life=186,owner=0,id=1,shape=0}={}){pool.set([x*Q,y*Q,vx*Q,vy*Q,life,owner,id,0x10000000|shape]);}
test('debris hits a moving ship, rebounds and reduces speed slightly without damaging hull',async()=>{
  const {s,st,pool}=await create();st[32]=40*Q;st[33]=0;st[34]=-10*Q;
  chip(pool,{vx:64});st[3]=1;
  step(s);
  assert.ok(Math.abs(st[34])/Q>9.7&&Math.abs(st[34])/Q<10);
  assert.equal(st[39],3);assert.ok(pool[2]<0);assert.ok(pool[7]&131072);
  assert.equal(st[43],0);
});
test('a dense cloud applies at most one slowdown per tick',async()=>{
  const {s,st,pool}=await create();st[32]=40*Q;st[33]=0;st[34]=-10*Q;
  for(let i=0;i<16;i++)chip(pool.subarray(i*8),{vx:64,id:i+1});st[3]=16;
  step(s);assert.ok(Math.abs(st[34])/Q>9.75&&Math.abs(st[34])/Q<9.77);assert.equal(st[39],3);
});
test('near misses and dead ships do not take debris impacts',async()=>{
  for(const dead of [false,true]){
    const {s,st,pool}=await create();st[32]=40*Q;st[33]=(dead?0:50)*Q;st[34]=-10*Q;
    if(dead){st[39]=0;st[42]=120;}
    chip(pool,{vx:64});st[3]=1;step(s);assert.equal(st[34],dead?-10*Q:-652803);assert.equal(pool[7]&131072,0);
  }
});
test('debris retains momentum in open space, expires at 3.1 seconds and restores through snapshots',async()=>{
  const {s,st,pool}=await create();chip(pool,{x:1000,vx:4,vy:-2});st[3]=1;
  step(s,60);assert.equal(pool[2],4*Q);assert.equal(pool[4],126);
  s.save_state(65536);step(s,60);const hash=s.state_hash(),copy=st.slice();
  assert.equal(s.load_state(65536,8512),1);step(s,60);assert.equal(s.state_hash(),hash);assert.deepEqual(st,copy);
  step(s,60);assert.equal(pool[4],6);step(s,3);assert.equal(pool[4],3);step(s,3);assert.ok(pool.every(v=>v===0));
});
test('fast debris bounces off cave walls and platforms',async()=>{
  for(const vertical of [false,true]){
    const {s,st,pool}=await create(32768);
    chip(pool,vertical?{x:1000,y:460,vy:64}:{x:1400,y:1000,vx:64});st[3]=1;step(s,2);
    assert.ok(pool[vertical?3:2]<0);
    assert.ok(pool[vertical?1:0]<(vertical?500:1450)*Q);
    step(s,10);s.save_state(65536);assert.equal(s.load_state(65536,8512),1);
  }
});
test('ship destruction creates sixteen canonical fragments with ship momentum',async()=>{
  const {s,st,pool}=await create(32768);st[16]=1420*Q;st[17]=1000*Q;st[18]=64*Q;st[24]=0;
  step(s);assert.equal(st[23],0);
  assert.equal(Array.from({length:256},(_,i)=>pool[i*8+7]).filter(Boolean).length,16);
  assert.ok(Array.from({length:16},(_,i)=>Math.abs(pool[i*8+2])/Q).every(v=>v>25));
  s.save_state(65536);assert.equal(s.load_state(65536,8512),1);
});
test('debris contact and its slowdown reproduce exactly after rollback',async()=>{
  const {s,st,pool}=await create();st[32]=40*Q;st[33]=0;st[34]=-10*Q;chip(pool,{vx:64});st[3]=1;
  s.save_state(65536);step(s,10);const hash=s.state_hash(),first=st.slice();
  assert.equal(s.load_state(65536,8512),1);step(s,10);assert.equal(s.state_hash(),hash);assert.deepEqual(st,first);
});
test('snapshot validation rejects malformed debris metadata and lifetime atomically',async()=>{
  const {s,st,pool}=await create();chip(pool,{x:1000});st[3]=1;
  for(const [offset,value]of [[28,0x10000010],[28,0x10040000],[28,1],[16,187]]){
    s.save_state(65536);new DataView(s.memory.buffer).setInt32(65536+320+offset,value,true);
    const hash=s.state_hash();assert.equal(s.load_state(65536,8512),0);assert.equal(s.state_hash(),hash);
  }
});
