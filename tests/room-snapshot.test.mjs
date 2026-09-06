import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {restoreRoom} from '../src/room-snapshot.ts';
import {NetworkSession} from '../src/network-session.ts';
const binary=await readFile('public/simulation.wasm');
const identity=JSON.parse(await readFile('public/build.json','utf8'));
const encode=engine=>Buffer.from(engine.save()).toString('base64');
test('solo online simulation advances without waiting for other inputs',async()=>{
  const engine=await Engine.create(binary,32768,19,1);
  const session=new NetworkSession(engine,0,{id:'a'.repeat(32),players:1,seed:19,epoch:1,identity,inputDelay:2,recoveryPeer:0,region:'eu',quick:true},{gameplay:()=>{},control:()=>{},diagnostic:()=>{}});
  const initial=engine.frame();for(let i=0;i<180;i++)assert.equal(session.scheduled(1),true);
  assert.equal(session.peer.tick,180);assert.equal(session.peer.stalls,0);assert.notEqual(engine.frame()[17],initial[17]);engine.load(engine.save());
});
test('joining preserves existing ship state and adds a new pilot with zero score',async()=>{
  const old=await Engine.create(binary,32768,19,1);for(let i=0;i<60;i++)old.step([1]);
  const before=old.frame(),engine=await restoreRoom(binary,19,2,encode(old),[0,-1]);
  assert.deepEqual(engine.frame().slice(16,32),before.slice(16,32));assert.equal(engine.frame()[0],before[0]);
  engine.step([0,0]);assert.equal(engine.frame()[39],3);assert.equal(engine.frame()[43],0);engine.load(engine.save());
});
test('departure compacts ship and projectile ownership without resetting surviving scores',async()=>{
  const old=await Engine.create(binary,32768,19,3);for(let i=0;i<60;i++)old.step([0,0,0]);
  const state=new Int32Array(old.wasm.memory.buffer,4096,2128);state[59]=3;old.step([8,8,8]);
  const before=old.frame(),engine=await restoreRoom(binary,19,2,encode(old),[0,2]);
  assert.deepEqual(engine.frame().slice(32,48),before.slice(48,64));assert.equal(engine.frame()[43],3);
  const next=new Int32Array(engine.save().buffer);for(let o=80;o<next.length;o+=8)if(next[o+4])assert.ok(next[o+5]<2);
  engine.step([0,0]);engine.load(engine.save());
  const solo=await restoreRoom(binary,19,1,encode(engine),[1]);assert.equal(solo.frame()[27],3);solo.load(solo.save());
});
test('room snapshots reject invalid ownership and corrupt source state',async()=>{
  const old=await Engine.create(binary,32768,19,2);
  await assert.rejects(()=>restoreRoom(binary,19,2,encode(old),[0,0]));
  const bytes=old.save();bytes[20]=5;await assert.rejects(()=>restoreRoom(binary,19,2,Buffer.from(bytes).toString('base64'),[0,1]));
});
test('a join at the round boundary starts everybody at zero',async()=>{
  const old=await Engine.create(binary,32768,19,2);for(let i=0;i<60;i++)old.step([0,0]);
  const state=new Int32Array(old.wasm.memory.buffer,4096,2128);state[27]=5;state[1]=0;old.load(old.save());
  const engine=await restoreRoom(binary,19,3,encode(old),[0,1,-1]);
  assert.equal(engine.frame()[1],-1);for(let id=0;id<3;id++)assert.equal(engine.frame()[27+id*16],0);
});
test('quick rounds retain the first confirmed five-point finish even across tied scores',async()=>{
  const engine=await Engine.create(binary,32768,19,2);
  for(let tick=0;tick<100;tick++)engine.step([0,0]);
  const state=new Int32Array(engine.wasm.memory.buffer,4096,2128);state[27]=5;state[43]=5;
  const session=new NetworkSession(engine,0,{id:'a'.repeat(32),players:2,seed:19,epoch:1,identity,inputDelay:2,recoveryPeer:0,region:'eu',quick:true},{gameplay:()=>{},control:()=>{},diagnostic:()=>{}});
  session.scheduled(0);assert.equal(session.frame()[27],5);assert.equal(session.frame()[43],5);
  state[27]=6;session.scheduled(0);assert.equal(session.frame()[27],5);assert.equal(session.frame()[43],5);
});
