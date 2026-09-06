import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Engine} from '../src/engine.ts';
import {recordReplay,ReplayPlayer,checkReplay} from '../src/replay.ts';
import {laboratory} from '../src/laboratory.ts';
const wasm=await readFile('public/simulation.wasm'),identity=JSON.parse(await readFile('public/build.json','utf8'));
test('replay checkpoints, validation and arbitrary seeks use the same WASM',async()=>{
  const inputs=Array.from({length:300},(_,t)=>[(t*7+(t>>3))&63,(t*3+(t>>4))&63]);
  const replay=await recordReplay(wasm,identity,inputs);checkReplay(replay,identity);
  const player=new ReplayPlayer(await Engine.create(wasm),replay);
  assert.equal(await player.validate(),replay.checkpoints.at(-1).hash);
  for(const tick of [240,0,60,121,299,300,1]){const reference=await Engine.create(wasm);for(let t=0;t<tick;t++)reference.step(inputs[t]);player.seek(tick);assert.equal(player.engine.hash(),reference.hash());}
});
test('replay rejects incompatible builds, malformed inputs and forged checkpoints',async()=>{
  const replay=await recordReplay(wasm,identity,Array.from({length:60},()=>[1,0]));
  assert.throws(()=>checkReplay({...replay,identity:{...identity,wasm:'wrong'}},identity));
  assert.throws(()=>checkReplay({...replay,inputs:[[64,0]]},identity));
  replay.checkpoints[0].hash='1';const player=new ReplayPlayer(await Engine.create(wasm),replay);await assert.rejects(()=>player.validate(),/diverges/);assert.throws(()=>player.seek(60),/Corrupt/);
});
test('interactive laboratory survives the worst selectable conditions',async()=>{
  const result=await laboratory(wasm,identity,{rtt:200,jitter:100,loss:.5,outage:3000});
  assert.deepEqual(result.hashes,[result.reference,result.reference]);assert.ok(result.metrics.every(m=>m.maxDepth<=12&&m.stalls>0));
  const player=new ReplayPlayer(await Engine.create(wasm),result.replay);assert.equal(await player.validate(),result.reference);
});
for(const players of [3,4])test(`${players}-player replays preserve all input columns, seed, mode and seek hashes`,async()=>{
  const inputs=Array.from({length:300},(_,tick)=>Array.from({length:players},(_,id)=>(tick*7+id*11)&63));
  const replay=await recordReplay(wasm,identity,inputs,32769,0xffffffff,players);checkReplay(replay,identity);
  const player=new ReplayPlayer(await Engine.create(wasm,32769,0xffffffff,players),replay);
  assert.equal(await player.validate(),replay.checkpoints.at(-1).hash);
  for(const tick of [0,121,299,60,300]){const reference=await Engine.create(wasm,32769,0xffffffff,players);for(let t=0;t<tick;t++)reference.step(inputs[t]);player.seek(tick);assert.equal(player.engine.hash(),reference.hash());}
  assert.throws(()=>checkReplay({...replay,players:2},identity));assert.throws(()=>checkReplay({...replay,players:5},identity));
  const corrupt=structuredClone(replay);corrupt.inputs[0][players-1]=64;assert.throws(()=>checkReplay(corrupt,identity));
  assert.throws(()=>new ReplayPlayer(player.engine,{...replay,seed:0}));
});
